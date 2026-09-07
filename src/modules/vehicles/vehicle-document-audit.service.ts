import { DocumentType } from '@prisma/client';
import { prisma } from '../../config/index.js';
import { headObject, keyFromPublicUrl } from '../../services/s3.service.js';
import { cacheKeys, deleteCache } from '../../services/cache.service.js';
import { createNotification } from '../notification/notification.service.js';
import { sendMail } from '../mail/mail.service.js';
import { logError, logInfo } from '../../utils/logger.js';

/**
 * Audit vehicle documents against storage.
 *
 * Uploading a document is four calls (presign -> PUT -> confirm -> attach). Everything after
 * the PUT can fail on its own, and when it does the row is written while the object never
 * leaves tmp/ — where the bucket lifecycle rule reaps it. The draft-save check
 * (`findMissingDocumentObjects`) is the only guard, it runs before the rows exist, and it
 * deliberately fails open. So a vehicle can sit in the database for months looking complete
 * while we hold no file at all, and the driver only learns of it when someone asks for the
 * document.
 *
 * This walks the persisted rows and asks storage directly. What it finds goes on the row, so
 * reads stay cheap: nothing on the request path ever touches S3.
 */

/** Rows per storage pass. Each row is one HEAD, so this bounds how long a batch holds open. */
const DEFAULT_BATCH_SIZE = 200;

/** Skip rows the audit already reached a verdict on this recently. */
const DEFAULT_RECHECK_AFTER_HOURS = 20;

export interface AuditOptions {
    /** Rows to examine. Omit to walk everything eligible — that is the backfill. */
    limit?: number;
    batchSize?: number;
    recheckAfterHours?: number;
    /** Report what would change without writing rows, busting caches or messaging anyone. */
    dryRun?: boolean;
    /** Flag the rows but stay silent. For the first backfill pass over old data. */
    notify?: boolean;
}

export interface AuditSummary {
    checked: number;
    missing: number;
    recovered: number;
    /** Rows storage could not be asked about — left exactly as they were. */
    inconclusive: number;
    vehiclesNotified: number;
    missingByDocumentType: Partial<Record<DocumentType, number>>;
}

type AuditableDocument = {
    id: string;
    vehicleId: string;
    documentType: DocumentType;
    image: string | null;
    imageKey: string | null;
    storageMissingAt: Date | null;
};

/** A definitive verdict, or `null` when storage could not be asked. */
type Verdict = 'present' | 'missing' | null;

/**
 * Where this row's bytes should live. `imageKey` is authoritative; public rows predating it
 * carry only the URL, which the key can be recovered from.
 */
export const resolveDocumentKey = (doc: { image: string | null; imageKey: string | null }): string | null =>
    doc.imageKey || (doc.image ? keyFromPublicUrl(doc.image) : null);

/**
 * Ask storage about one row.
 *
 * A row with no resolvable key is missing by definition — it names no object, so no object
 * can be produced for it. Anything other than a definitive 404 is inconclusive and returns
 * null: headObject throws on every non-404 error (and always in local-disk mode, where there
 * is no bucket), and telling a driver their good document vanished because the bucket was
 * briefly unreachable is worse than saying nothing.
 */
const checkDocument = async (doc: AuditableDocument): Promise<Verdict> => {
    const key = resolveDocumentKey(doc);
    if (!key) return 'missing';

    try {
        const head = await headObject(key);
        return head.exists ? 'present' : 'missing';
    } catch (error) {
        logError('Could not verify vehicle document object; leaving the row unchanged', error, {
            vehicleDocumentId: doc.id,
            vehicleId: doc.vehicleId,
            documentType: doc.documentType,
            key,
        });
        return null;
    }
};

const documentLabel = (type: DocumentType): string =>
    type
        .toLowerCase()
        .split('_')
        .join(' ');

/**
 * Tell the owner once, then record that we did.
 *
 * The timestamp is written before the message goes out: a notification that fails is
 * recoverable noise, a loop that re-notifies every night is not. It is cleared again in
 * `settleVehicle` when the vehicle recovers, so a later breakage is announced afresh.
 */
const notifyOwner = async (vehicleId: string, missingTypes: DocumentType[]): Promise<boolean> => {
    const vehicle = await prisma.vehicle.findUnique({
        where: { id: vehicleId },
        select: {
            id: true,
            documentIssueNotifiedAt: true,
            brand: true,
            model_name: true,
            licenseNumber: true,
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
    });

    if (!vehicle || vehicle.documentIssueNotifiedAt) return false;

    await prisma.vehicle.update({
        where: { id: vehicle.id },
        data: { documentIssueNotifiedAt: new Date() },
    });

    const vehicleLabel =
        [vehicle.brand, vehicle.model_name].filter(Boolean).join(' ').trim() || vehicle.licenseNumber;
    const documents = missingTypes.map(documentLabel).join(', ');
    const title = 'Vehicle document did not reach us';
    const body =
        `The ${documents} you uploaded for your ${vehicleLabel} never reached our system, so we are ` +
        'not holding the file. Please delete the vehicle and add it again with the document.';

    try {
        await createNotification({
            userId: vehicle.user.id,
            type: 'vehicle.document.missing',
            title,
            body,
            data: {
                vehicleId: vehicle.id,
                documentTypes: missingTypes,
                deepLink: `app://vehicle/${vehicle.id}`,
            },
        });

        if (vehicle.user.email) {
            const name =
                [vehicle.user.firstName, vehicle.user.lastName].filter(Boolean).join(' ').trim() ||
                vehicle.user.email;
            const text = `${title}\n\nHello ${name},\n\n${body}\n\nDeliivo`;
            const html = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #111827;">
        <h2 style="margin: 0 0 12px;">${title}</h2>
        <p style="margin: 0 0 12px;">Hello ${name},</p>
        <p style="margin: 0 0 12px;">${body}</p>
        <p style="margin: 16px 0 0;">Deliivo</p>
      </div>
    `;
            await sendMail({ to: vehicle.user.email, subject: `Deliivo: ${title}`, html, text });
        }
    } catch (error) {
        // The guard timestamp stands either way. Retrying the message on the next pass would
        // mean re-notifying every driver whose email bounced, every night.
        logError('Failed to tell the owner their vehicle document is missing', error, {
            vehicleId: vehicle.id,
            userId: vehicle.user.id,
        });
    }

    return true;
};

/**
 * Bring a vehicle's state in line with what the pass just learned about its documents, and
 * bust the caches that would otherwise keep serving the old answer.
 */
const settleVehicle = async (
    vehicleId: string,
    missingTypes: DocumentType[],
    notify: boolean,
): Promise<boolean> => {
    const vehicle = await prisma.vehicle.findUnique({
        where: { id: vehicleId },
        select: { id: true, userId: true, documentIssueNotifiedAt: true },
    });
    if (!vehicle) return false;

    await deleteCache(cacheKeys.vehicle(vehicle.id));
    await deleteCache(cacheKeys.userVehicles(vehicle.userId));

    if (missingTypes.length === 0) {
        // Recovered — someone re-uploaded, or the object was there all along and an earlier pass
        // caught a bad moment. Clearing the guard lets a future breakage speak up.
        if (vehicle.documentIssueNotifiedAt) {
            await prisma.vehicle.update({
                where: { id: vehicle.id },
                data: { documentIssueNotifiedAt: null },
            });
        }
        return false;
    }

    if (!notify) return false;
    return notifyOwner(vehicle.id, missingTypes);
};

/**
 * Walk vehicle documents and record, per row, whether storage actually holds the file.
 *
 * Rows are taken oldest-verdict-first (never-checked before long-ago-checked) so a run capped
 * by `limit` still makes progress across the whole table rather than re-reading the same head.
 */
export const auditVehicleDocuments = async (options: AuditOptions = {}): Promise<AuditSummary> => {
    const {
        limit,
        batchSize = DEFAULT_BATCH_SIZE,
        recheckAfterHours = DEFAULT_RECHECK_AFTER_HOURS,
        dryRun = false,
        notify = true,
    } = options;

    const summary: AuditSummary = {
        checked: 0,
        missing: 0,
        recovered: 0,
        inconclusive: 0,
        vehiclesNotified: 0,
        missingByDocumentType: {},
    };

    const staleBefore = new Date(Date.now() - recheckAfterHours * 60 * 60 * 1000);
    // Vehicles a driver has already deleted are not worth a HEAD, and their owner does not
    // need telling about a document on a vehicle that is gone.
    const where = {
        vehicle: { deletedAt: null },
        OR: [{ storageCheckedAt: null }, { storageCheckedAt: { lt: staleBefore } }],
    };

    // Rows whose verdict changed, grouped so each vehicle is settled once at the end even when
    // its documents span batches.
    const touchedVehicles = new Set<string>();

    while (limit === undefined || summary.checked < limit) {
        const take = limit === undefined ? batchSize : Math.min(batchSize, limit - summary.checked);
        const documents = await prisma.vehicleDocument.findMany({
            where,
            // Nulls first on Postgres ascending, which is what we want: never-checked rows lead.
            orderBy: { storageCheckedAt: 'asc' },
            take,
            select: {
                id: true,
                vehicleId: true,
                documentType: true,
                image: true,
                imageKey: true,
                storageMissingAt: true,
            },
        });

        if (documents.length === 0) break;

        for (const doc of documents) {
            const verdict = await checkDocument(doc);
            summary.checked++;

            if (verdict === null) {
                summary.inconclusive++;
                continue;
            }

            if (verdict === 'missing') {
                summary.missing++;
                summary.missingByDocumentType[doc.documentType] =
                    (summary.missingByDocumentType[doc.documentType] || 0) + 1;
            } else if (doc.storageMissingAt) {
                summary.recovered++;
            }

            touchedVehicles.add(doc.vehicleId);

            if (dryRun) continue;

            await prisma.vehicleDocument.update({
                where: { id: doc.id },
                data: {
                    storageCheckedAt: new Date(),
                    // Keep the original discovery time rather than stamping it afresh each pass,
                    // so "how long has this been broken" stays answerable.
                    storageMissingAt:
                        verdict === 'missing' ? doc.storageMissingAt ?? new Date() : null,
                },
            });
        }

        // A short batch means the eligible set is exhausted; anything else would loop forever
        // once `where` stops matching what we just stamped.
        if (documents.length < take) break;
    }

    if (!dryRun) {
        for (const vehicleId of touchedVehicles) {
            const stillMissing = await prisma.vehicleDocument.findMany({
                where: { vehicleId, storageMissingAt: { not: null } },
                select: { documentType: true },
            });
            const notified = await settleVehicle(
                vehicleId,
                stillMissing.map((d) => d.documentType),
                notify,
            );
            if (notified) summary.vehiclesNotified++;
        }
    }

    logInfo('Vehicle document audit complete', { ...summary, dryRun, notify });
    return summary;
};
