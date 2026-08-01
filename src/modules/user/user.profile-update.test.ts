const mockPrisma = {
    user: {
        update: jest.fn(),
    },
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

import { updateProfileService } from './user.service';

describe('updateProfileService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.user.update.mockResolvedValue({ id: 'user-1' });
    });

    // PUT /users/me has no request validator, so the payload reaches the service as-is.
    it('writes only the profile columns and ignores everything else', async () => {
        const res = await updateProfileService('user-1', {
            firstName: 'Jon',
            lastName: 'Smith',
            salutation: 'MR',
            gender: 'MALE',
            role: 'ADMIN',
            isBanned: false,
            dlVerified: true,
            isVerified: true,
            username: 'legacy-field',
        });

        expect(res.success).toBe(true);
        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            data: { firstName: 'Jon', lastName: 'Smith', salutation: 'MR', gender: 'MALE' },
        });
    });

    it('refuses to escalate a role even when it is the only field sent', async () => {
        const res = await updateProfileService('user-1', { role: 'ADMIN' });

        expect(res).toEqual({ success: false, reason: 'NO_UPDATABLE_FIELDS' });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    // Prisma rejects a bare YYYY-MM-DD for a DateTime column, which used to surface as
    // 'Internal server error' and left the profile without the DOB that KYC requires.
    it('accepts a date-only dob and stores it as a UTC Date', async () => {
        const res = await updateProfileService('user-1', { dob: '1990-05-15', gender: 'MALE' });

        expect(res.success).toBe(true);
        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            data: { gender: 'MALE', dob: new Date('1990-05-15T00:00:00.000Z') },
        });
    });

    it('rejects an unparseable dob without touching the database', async () => {
        const res = await updateProfileService('user-1', { dob: 'not-a-date' });

        expect(res).toEqual({ success: false, reason: 'INVALID_DATE_OF_BIRTH' });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a dob that is not a string', async () => {
        const res = await updateProfileService('user-1', { dob: 19900515 });

        expect(res).toEqual({ success: false, reason: 'INVALID_DATE_OF_BIRTH' });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
});
