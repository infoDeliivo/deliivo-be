import type { Prisma } from '@prisma/client';
import { ensureRequestPayment } from './ride-request.payment';

const booking = {
  id: 'booking',
  rideId: 'ride',
  passengerId: 'rider',
  totalPrice: 40,
  paymentCurrency: 'EUR',
  stripePaymentIntentId: 'pi_test',
};

function fixture(existing?: Record<string, unknown>) {
  let record = existing;
  const payment = {
    upsert: jest.fn().mockImplementation(async ({ create }) => {
      record ??= { id: 'payment', ...create };
      return record;
    }),
    updateMany: jest.fn().mockImplementation(async ({ data }) => {
      Object.assign(record!, data);
      return { count: 1 };
    }),
  };
  return { payment, db: { payment } as unknown as Pick<Prisma.TransactionClient, 'payment'> };
}

describe('request payment bookkeeping', () => {
  const originalFee = process.env.PLATFORM_FEE_PERCENT;
  beforeEach(() => {
    process.env.PLATFORM_FEE_PERCENT = '10';
  });
  afterAll(() => {
    if (originalFee === undefined) delete process.env.PLATFORM_FEE_PERCENT;
    else process.env.PLATFORM_FEE_PERCENT = originalFee;
  });
  it('creates a missing pending payment from the server-side booking', async () => {
    const { db } = fixture();
    await expect(ensureRequestPayment(db, booking)).resolves.toMatchObject({
      bookingId: 'booking',
      riderId: 'rider',
      rideId: 'ride',
      stripePaymentIntentId: 'pi_test',
      amountTotal: 40,
      platformFeeAmount: 4,
      fareAmount: 36,
      currency: 'EUR',
      status: 'PAYMENT_PENDING',
    });
  });
  it('repeated recovery keeps one payment and preserves the original fee snapshot', async () => {
    const { db, payment } = fixture();
    const first = await ensureRequestPayment(db, booking);
    process.env.PLATFORM_FEE_PERCENT = '20';
    expect(await ensureRequestPayment(db, booking)).toBe(first);
    expect(first.platformFeeAmount).toBe(4);
    expect(payment.upsert.mock.calls[1][0].update).toEqual({ bookingId: 'booking' });
  });
  it('uses the stored service fee instead of deducting a percentage of the total', async () => {
    const { db } = fixture();
    process.env.PLATFORM_FEE_PERCENT = 'invalid';
    await expect(ensureRequestPayment(db, { ...booking, totalPrice: 24, serviceFeeAmount: 4 })).resolves.toMatchObject({
      amountTotal: 24, platformFeeAmount: 4, fareAmount: 20,
    });
  });
  it('preserves an explicitly zero service fee', async () => {
    const { db } = fixture();
    await expect(ensureRequestPayment(db, { ...booking, serviceFeeAmount: 0 })).resolves.toMatchObject({
      platformFeeAmount: 0, fareAmount: 40,
    });
  });
  it('does not reset an already paid payment on a retry', async () => {
    const { db } = fixture({
      id: 'payment',
      bookingId: booking.id,
      rideId: booking.rideId,
      riderId: booking.passengerId,
      amountTotal: 40,
      currency: 'EUR',
      stripePaymentIntentId: 'pi_test',
      status: 'PAID',
    });
    expect((await ensureRequestPayment(db, booking)).status).toBe('PAID');
  });
  it('repairs a missing intent link without changing an existing payment status', async () => {
    const { db, payment } = fixture({
      id: 'payment',
      rideId: 'ride',
      riderId: 'rider',
      amountTotal: 40,
      currency: 'EUR',
      stripePaymentIntentId: null,
      status: 'CREATED',
    });
    const result = await ensureRequestPayment(db, booking);
    expect(payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'payment', stripePaymentIntentId: null },
      data: { stripePaymentIntentId: 'pi_test' },
    });
    expect(result.status).toBe('CREATED');
  });
  it.each([
    { stripePaymentIntentId: 'different' },
    { amountTotal: 100 },
    { riderId: 'stranger' },
    { currency: 'USD' },
  ])('rejects mismatched payment records: %j', async (override) => {
    const { db } = fixture({
      id: 'payment',
      rideId: 'ride',
      riderId: 'rider',
      amountTotal: 40,
      currency: 'EUR',
      stripePaymentIntentId: 'pi_test',
      ...override,
    });
    await expect(ensureRequestPayment(db, booking)).rejects.toThrow(
      'REQUEST_PAYMENT_RECORD_MISMATCH',
    );
  });
  it('fails closed when persistence fails', async () => {
    const { db, payment } = fixture();
    payment.upsert.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(ensureRequestPayment(db, booking)).rejects.toThrow('database unavailable');
  });
  it.each([
    { stripePaymentIntentId: null },
    { paymentCurrency: null },
  ])('does not invent missing payment metadata: %j', async (missing) => {
    const { db, payment } = fixture();
    await expect(ensureRequestPayment(db, { ...booking, ...missing })).rejects.toThrow();
    expect(payment.upsert).not.toHaveBeenCalled();
  });
});
