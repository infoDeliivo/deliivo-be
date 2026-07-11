/**
 * One-off cleanup: DELETE the legacy exposed private vehicle documents.
 *
 * Before the private-draft fix, DRIVING_LICENSE / INSURANCE_DOCUMENT / VEHICLE_DOCUMENT
 * rows were stored as PUBLIC objects (imageUrl set, imageKey null) — world-readable by URL.
 * We do not keep these; the frontend re-uploads them through the private flow.
 *
 * For each matching row this script:
 *   1. deletes the underlying storage object (best-effort, idempotent),
 *   2. deletes the VehicleDocument row.
 *
 * Only targets the exposed legacy rows (private type, imageUrl set, imageKey null).
 * VEHICLE_IMAGE and already-private rows (imageKey set) are left untouched.
 *
 * Run:  node --loader ts-node/esm src/scripts/delete-public-vehicle-docs.ts
 *       node --loader ts-node/esm src/scripts/delete-public-vehicle-docs.ts --dry-run
 */
import { DocumentType } from '@prisma/client';
import { prisma } from '../config/index.js';
import { keyFromPublicUrl, deleteObject } from '../services/s3.service.js';
import { logError } from '../utils/logger.js';

const PRIVATE_DOCUMENT_TYPES: DocumentType[] = [
    DocumentType.DRIVING_LICENSE,
    DocumentType.INSURANCE_DOCUMENT,
    DocumentType.VEHICLE_DOCUMENT,
];

const main = async () => {
    const dryRun = process.argv.includes('--dry-run');
    console.log(`[cleanup-public-docs] start${dryRun ? ' (dry-run)' : ''}`);

    const rows = await prisma.vehicleDocument.findMany({
        where: {
            documentType: { in: PRIVATE_DOCUMENT_TYPES },
            imageKey: null,
            image: { not: null },
        },
        select: { id: true, image: true, documentType: true },
    });

    console.log(`[cleanup-public-docs] ${rows.length} exposed document(s) to delete`);

    let deleted = 0;
    let failed = 0;

    for (const row of rows) {
        const key = keyFromPublicUrl(row.image!);

        if (dryRun) {
            console.log(`[dry-run] delete ${row.id} (${row.documentType}) object=${key ?? 'unparseable'}`);
            deleted += 1;
            continue;
        }

        try {
            if (key) {
                await deleteObject(key); // best-effort; missing object is not an error
            } else {
                console.warn(`[warn] ${row.id}: could not parse object key; deleting row only`);
            }
            await prisma.vehicleDocument.delete({ where: { id: row.id } });
            console.log(`[ok] deleted ${row.id} (${row.documentType})`);
            deleted += 1;
        } catch (error) {
            logError(`[cleanup-public-docs] failed for ${row.id}`, error);
            failed += 1;
        }
    }

    console.log(`[cleanup-public-docs] done — deleted=${deleted} failed=${failed}`);
    await prisma.$disconnect();
    process.exit(failed > 0 ? 1 : 0);
};

main().catch(async (error) => {
    logError('[cleanup-public-docs] fatal', error);
    await prisma.$disconnect();
    process.exit(1);
});
