const mockGetDisputeById = jest.fn();

jest.mock('./dispute.service.js', () => ({
    __esModule: true,
    getDisputeById: mockGetDisputeById,
    createDispute: jest.fn(),
    collectEvidence: jest.fn(),
    evaluateDispute: jest.fn(),
    listDisputes: jest.fn(),
    getUserDisputes: jest.fn(),
}));

jest.mock('./dispute-settlement.service.js', () => ({
    __esModule: true,
    settleDispute: jest.fn(),
}));

import { getMyDisputeHandler } from './dispute.controller.js';

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
