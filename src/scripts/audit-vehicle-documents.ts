/**
 * Backfill pass of the vehicle document audit.
 *
 * The nightly job (`vehicle-document-audit` in src/queue/maintenance.queue.ts) rechecks rows on
 * a rolling basis. This runs the same pass over everything at once, for the first sweep of the
 * existing backlog — vehicles whose documents were already lost before any of this existed.
 *
 * Do the dry pass first, on production data, to see how many drivers this is about to reach:
 *   node --loader ts-node/esm src/scripts/audit-vehicle-documents.ts --dry-run
 *
 * Then flag the rows without messaging anyone, if you would rather review the list first:
 *   node --loader ts-node/esm src/scripts/audit-vehicle-documents.ts --notify=false
 *
 * Then for real:
 *   node --loader ts-node/esm src/scripts/audit-vehicle-documents.ts
 *
 * Options: --limit=<n> caps rows examined, --recheck-hours=<n> overrides how recently a row
 * must have been checked to be skipped (pass 0 to force a full re-read).
 */
import { auditVehicleDocuments } from '../modules/vehicles/vehicle-document-audit.service.js';
import { prisma } from '../config/index.js';

const flag = (name: string): string | undefined => {
    const match = process.argv.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
    if (!match) return undefined;
    const [, value] = match.split('=');
    return value ?? 'true';
};

const numberFlag = (name: string): number | undefined => {
    const raw = flag(name);
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`--${name} must be a non-negative number, got '${raw}'`);
    }
    return parsed;
};

const main = async (): Promise<void> => {
    const dryRun = flag('dry-run') === 'true';
    // --notify=false suppresses; anything else (including omitting it) notifies.
    const notify = flag('notify') !== 'false';
    const limit = numberFlag('limit');
    const recheckAfterHours = numberFlag('recheck-hours');

    console.log(
        `Auditing vehicle documents${dryRun ? ' (dry run — nothing will be written)' : ''}` +
            `${!dryRun && !notify ? ' (flagging only — no notifications or emails)' : ''}`,
    );

    const summary = await auditVehicleDocuments({ dryRun, notify, limit, recheckAfterHours });

    console.log('');
    console.log(`  checked          ${summary.checked}`);
    console.log(`  missing          ${summary.missing}`);
    console.log(`  recovered        ${summary.recovered}`);
    console.log(`  inconclusive     ${summary.inconclusive}  (storage could not be asked)`);
    console.log(`  owners notified  ${summary.vehiclesNotified}`);
    if (summary.missing > 0) {
        console.log('  missing by type:');
        for (const [type, count] of Object.entries(summary.missingByDocumentType)) {
            console.log(`    ${type}: ${count}`);
        }
    }
};

main()
    .catch((error) => {
        console.error('Vehicle document audit failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
        // The notification path pulls in Redis and the BullMQ push queue, whose connections keep
        // the event loop alive indefinitely. Nothing is left to flush once prisma is closed, so
        // exit rather than leaving an ops script hanging at the end of a completed run.
        process.exit(process.exitCode ?? 0);
    });
