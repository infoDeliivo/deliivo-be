const mockGetDisputeById = jest.fn();
const mockListDisputes = jest.fn();

jest.mock('./dispute.service.js', () => ({
    __esModule: true,
    getDisputeById: mockGetDisputeById,
    createDispute: jest.fn(),
    collectEvidence: jest.fn(),
    evaluateDispute: jest.fn(),
    listDisputes: (...args: unknown[]) => mockListDisputes(...args),
    getUserDisputes: jest.fn(),
}));

jest.mock('./dispute-settlement.service.js', () => ({
    __esModule: true,
    settleDispute: jest.fn(),
}));

import { adminListDisputesHandler, getMyDisputeHandler } from './dispute.controller.js';

const dispute = {
    id: 'dispute-1',
    raisedBy: 'rider-1',
    booking: { id: 'booking-1', passengerId: 'rider-1' },
    ride: { id: 'ride-1', driverId: 'driver-1' },
};

const call = async (userId: string) => {
    const req: any = { params: { id: 'dispute-1' }, user: { id: userId } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await getMyDisputeHandler(req, res);
    return res;
};

describe('getMyDisputeHandler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetDisputeById.mockResolvedValue(dispute);
    });

    it.each(['rider-1', 'driver-1'])('returns the dispute to a party (%s)', async (userId) => {
        const res = await call(userId);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({ success: true, data: dispute });
    });

    it('returns 404 to a user who is not part of the dispute', async () => {
        const res = await call('stranger');
        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ data: dispute }));
    });

    it('returns 404 when the dispute does not exist', async () => {
        mockGetDisputeById.mockResolvedValue(null);
        const res = await call('rider-1');
        expect(res.status).toHaveBeenCalledWith(404);
    });
});

describe('adminListDisputesHandler', () => {
    const list = async (query: Record<string, string>) => {
        const req = { query } as unknown as Parameters<typeof adminListDisputesHandler>[0];
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
        await adminListDisputesHandler(req, res as unknown as Parameters<typeof adminListDisputesHandler>[1]);
        return res;
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockListDisputes.mockResolvedValue({ disputes: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    });

    it('passes a trimmed search and numeric paging to the service', async () => {
        await list({ search: '  Tallinn ', page: '2', limit: '10', status: 'OPEN' });
        expect(mockListDisputes).toHaveBeenCalledWith({ search: 'Tallinn', page: 2, limit: 10, status: 'OPEN' });
    });

    it('rejects an out-of-range limit with 400 instead of querying', async () => {
        const res = await list({ limit: '1000' });
        expect(res.status).toHaveBeenCalledWith(400);
        expect(mockListDisputes).not.toHaveBeenCalled();
    });
});
