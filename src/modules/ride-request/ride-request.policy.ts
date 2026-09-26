export const REQUEST_CHECKOUT_MS = 15 * 60 * 1000;

export function assertRequestWindow(after: Date, before: Date, now = new Date()) {
  if (
    !Number.isFinite(after.getTime()) ||
    !Number.isFinite(before.getTime()) ||
    after.getTime() < now.getTime() + 3 * 60 * 60 * 1000 ||
    before < after ||
    before.getTime() - after.getTime() > 24 * 60 * 60 * 1000 ||
    before.getTime() > now.getTime() + 180 * 24 * 60 * 60 * 1000
  ) {
    throw new Error(
      'Choose a future travel window of no more than 24 hours, at least three hours from now.',
    );
  }
}

export function assertOfferFits(
  request: { departureAfter: Date; departureBefore: Date; seats: number },
  departure: Date,
  seats: number,
) {
  if (departure < request.departureAfter || departure > request.departureBefore)
    throw new Error('Departure must be inside the requested time window.');
  if (seats < request.seats)
    throw new Error('The vehicle must offer enough seats for the requesting party.');
}
