import {
    buildVerificationSummary,
    deriveDlState,
    derivePayoutState,
    derivePendingReview,
    deriveVehicleState,
    type DlRecordInput,
} from './admin-user-status.js';

const dl = (status: DlRecordInput['status'], updatedAt: string, documentImageKey: string | null = null): DlRecordInput => ({
    status,
    documentImageKey,
    updatedAt: new Date(updatedAt),
});

describe('deriveDlState', () => {
    it('is NONE without any record', () => {
        expect(deriveDlState([])).toBe('NONE');
    });

    it('takes the most recently updated record', () => {
        expect(deriveDlState([dl('DECLINED', '2026-09-01'), dl('APPROVED', '2026-10-01')])).toBe('APPROVED');
    });

    it('ignores superseded records', () => {
        expect(deriveDlState([dl('SUPERSEDED', '2026-10-02'), dl('DECLINED', '2026-09-01')])).toBe('DECLINED');
        expect(deriveDlState([dl('SUPERSEDED', '2026-10-02')])).toBe('NONE');
    });
});

describe('deriveVehicleState', () => {
    it('is NONE without vehicles', () => {
        expect(deriveVehicleState([])).toEqual({ state: 'NONE', pending: 0, approved: 0, rejected: 0 });
    });

    it('lets a pending vehicle outrank approved and rejected ones', () => {
        expect(
            deriveVehicleState([
                { verificationStatus: 'APPROVED' },
                { verificationStatus: 'REJECTED' },
                { verificationStatus: 'PENDING' },
            ]),
        ).toEqual({ state: 'PENDING', pending: 1, approved: 1, rejected: 1 });
    });

    it('prefers APPROVED over REJECTED when nothing is pending', () => {
        expect(deriveVehicleState([{ verificationStatus: 'REJECTED' }, { verificationStatus: 'APPROVED' }]).state).toBe('APPROVED');
        expect(deriveVehicleState([{ verificationStatus: 'REJECTED' }]).state).toBe('REJECTED');
    });
});

describe('derivePayoutState', () => {
    const base = { stripeAccountId: null, stripeOnboardingComplete: false, stripeNameMatch: null, stripeDobMatch: null };

    it.each([
        [base, 'NOT_STARTED'],
        [{ ...base, stripeAccountId: 'acct_1' }, 'INCOMPLETE'],
        [{ ...base, stripeAccountId: 'acct_1', stripeOnboardingComplete: true }, 'READY'],
    ] as const)('maps %j to %s', (input, state) => {
        expect(derivePayoutState(input).state).toBe(state);
    });

    it('flags a mismatch only on an explicit false, not on an unchecked null', () => {
        expect(derivePayoutState(base).mismatch).toBe(false);
        expect(derivePayoutState({ ...base, stripeNameMatch: false }).mismatch).toBe(true);
        expect(derivePayoutState({ ...base, stripeNameMatch: true, stripeDobMatch: false }).mismatch).toBe(true);
    });
});

describe('derivePendingReview', () => {
    it('is empty when nothing awaits an admin', () => {
        expect(derivePendingReview([dl('APPROVED', '2026-10-01', 'dl/a.jpg')], [{ verificationStatus: 'APPROVED' }])).toEqual([]);
    });

    it('counts a PENDING DL upload but not a PENDING Veriff session without an image', () => {
        expect(derivePendingReview([dl('PENDING', '2026-10-01')], [])).toEqual([]);
        expect(derivePendingReview([dl('PENDING', '2026-10-01', 'dl/a.jpg')], [])).toEqual([{ kind: 'DL_REVIEW', count: 1 }]);
    });

    it('counts pending vehicles', () => {
        expect(
            derivePendingReview([], [{ verificationStatus: 'PENDING' }, { verificationStatus: 'PENDING' }, { verificationStatus: 'REJECTED' }]),
        ).toEqual([{ kind: 'VEHICLE_REVIEW', count: 2 }]);
    });
});

describe('buildVerificationSummary', () => {
    it('combines every derived state', () => {
        expect(
            buildVerificationSummary({
                stripeAccountId: 'acct_1',
                stripeOnboardingComplete: true,
                stripeNameMatch: true,
                stripeDobMatch: true,
                dlVerifications: [dl('APPROVED', '2026-10-01')],
                vehicles: [{ verificationStatus: 'PENDING' }],
            }),
        ).toEqual({
            dl: 'APPROVED',
            vehicle: { state: 'PENDING', pending: 1, approved: 0, rejected: 0 },
            payout: { state: 'READY', mismatch: false },
            pending: [{ kind: 'VEHICLE_REVIEW', count: 1 }],
        });
    });
});
