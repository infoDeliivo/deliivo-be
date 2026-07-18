import { authed } from './api.client';
import { RideState } from './state';

/** Returns a departure date N days from today as "YYYY-MM-DD" */
export function futureDateStr(daysFromNow = 30): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split('T')[0];
}

export interface PublishRideInput {
  originPlaceId?: string;
  originAddress: string;
  originLat: number;
  originLng: number;
  destinationPlaceId?: string;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  departureDate?: string;
  departureTime?: string;
  totalSeats?: number;
  basePricePerSeat?: number;
  currency?: string;
  femaleOnly?: boolean;
  stopover?: {
    placeId: string;
    address: string;
    lat: number;
    lng: number;
    pricePerSeat: number;
  };
}

/**
 * Walks through the full publish-ride wizard for a given driver token.
 * Returns the published rideId, or throws if any step fails.
 *
 * Note: Step 3 (computeRoutes) calls Google Maps API. If GOOGLE_MAPS_API_KEY
 * is not configured, this step will fail. Catch the error in the caller and
 * mark the test as skipped.
 */
export async function publishRide(
  token: string,
  input: PublishRideInput
): Promise<string> {
  const a = authed(token);
  const departureDate = input.departureDate ?? futureDateStr(30);
  const departureTime = input.departureTime ?? '09:00';

  // Step 1: Origin
  const originRes = await a.post('/publish-ride/draft/origin', {
    originPlaceId: input.originPlaceId ?? 'place-origin',
    originAddress: input.originAddress,
    originLat: input.originLat,
    originLng: input.originLng,
  });
  if (originRes.status !== 200 && originRes.status !== 201) {
    throw new Error(`Set origin failed: ${originRes.status} ${JSON.stringify(originRes.data)}`);
  }

  // Step 2: Destination
  const destRes = await a.put('/publish-ride/draft/destination', {
    destinationPlaceId: input.destinationPlaceId ?? 'place-destination',
    destinationAddress: input.destinationAddress,
    destinationLat: input.destinationLat,
    destinationLng: input.destinationLng,
  });
  if (destRes.status !== 200) {
    throw new Error(`Set destination failed: ${destRes.status} ${JSON.stringify(destRes.data)}`);
  }

  // Step 3: Compute routes (requires Google Maps API key)
  const routesRes = await a.get('/publish-ride/draft/routes/compute');
  if (routesRes.status !== 200) {
    throw new Error(
      `Compute routes failed: ${routesRes.status} ${JSON.stringify(routesRes.data)}. ` +
      'Ensure GOOGLE_MAPS_API_KEY is configured in the test environment.'
    );
  }

  // Step 4: Select first route
  const selectRes = await a.put('/publish-ride/draft/routes/select', { routeIndex: 0 });
  if (selectRes.status !== 200) {
    throw new Error(`Select route failed: ${selectRes.status} ${JSON.stringify(selectRes.data)}`);
  }

  // Step 5: Stopovers (optional)
  if (input.stopover) {
    const stopoverRes = await a.put('/publish-ride/draft/stopovers', {
      stopovers: [input.stopover],
    });
    if (stopoverRes.status !== 200) {
      throw new Error(`Set stopovers failed: ${stopoverRes.status} ${JSON.stringify(stopoverRes.data)}`);
    }
  }

  // Step 6: Schedule
  const scheduleRes = await a.put('/publish-ride/draft/schedule', {
    departureDate,
    departureTime,
  });
  if (scheduleRes.status !== 200) {
    throw new Error(`Set schedule failed: ${scheduleRes.status} ${JSON.stringify(scheduleRes.data)}`);
  }

  // Step 7: Capacity
  const capacityRes = await a.put('/publish-ride/draft/capacity', {
    totalSeats: input.totalSeats ?? 3,
    maxLuggagePerPerson: 1,
    backSeatOnly: false,
  });
  if (capacityRes.status !== 200) {
    throw new Error(`Set capacity failed: ${capacityRes.status} ${JSON.stringify(capacityRes.data)}`);
  }

  // Step 8: Pricing
  const pricingRes = await a.put('/publish-ride/draft/pricing', {
    basePricePerSeat: input.basePricePerSeat ?? 15.0,
    currency: input.currency ?? 'GBP',
  });
  if (pricingRes.status !== 200) {
    throw new Error(`Set pricing failed: ${pricingRes.status} ${JSON.stringify(pricingRes.data)}`);
  }

  // Step 9: Notes/preferences (optional — sets femaleOnly if needed)
  if (input.femaleOnly) {
    const notesRes = await a.patch('/publish-ride/draft/notes', {
      notes: '',
      femaleOnly: true,
    });
    if (notesRes.status !== 200) {
      throw new Error(`Set notes/femaleOnly failed: ${notesRes.status} ${JSON.stringify(notesRes.data)}`);
    }
  }

  // Step 10: Publish
  const publishRes = await a.post('/publish-ride/draft/publish');
  if (publishRes.status !== 200 && publishRes.status !== 201) {
    throw new Error(`Publish failed: ${publishRes.status} ${JSON.stringify(publishRes.data)}`);
  }

  const rideId: string =
    publishRes.data?.data?.id ??
    publishRes.data?.data?.rideId ??
    publishRes.data?.id;

  if (!rideId) {
    throw new Error(`Publish succeeded but no rideId in response: ${JSON.stringify(publishRes.data)}`);
  }

  return rideId;
}

/**
 * Build a RideState from a ride detail API response body.
 */
export function toRideState(rideData: Record<string, unknown>): RideState {
  return {
    id: rideData.id as string,
    originAddress: rideData.originAddress as string,
    destinationAddress: rideData.destinationAddress as string,
    originLat: rideData.originLat as number,
    originLng: rideData.originLng as number,
    destinationLat: rideData.destinationLat as number,
    destinationLng: rideData.destinationLng as number,
    departureDate: rideData.departureDate as string,
    departureTime: rideData.departureTime as string,
    basePricePerSeat: rideData.basePricePerSeat as number,
    currency: rideData.currency as string,
    availableSeats: rideData.availableSeats as number,
  };
}

/** Standard London → Manchester test route coordinates */
export const LONDON_TO_MANCHESTER = {
  originPlaceId: 'ChIJdd4hrwug2EcRmSrV3Vo6llI',
  originAddress: 'London, UK',
  originLat: 51.5074,
  originLng: -0.1278,
  destinationPlaceId: 'ChIJ2_UmUkxNekgRqmv-BDgUvtk',
  destinationAddress: 'Manchester, UK',
  destinationLat: 53.4808,
  destinationLng: -2.2426,
};

/** Milton Keynes — used as a stopover point */
export const MILTON_KEYNES_STOPOVER = {
  placeId: 'ChIJM5GaGdNhd0gRMBD_Bue-a_0',
  address: 'Milton Keynes, UK',
  lat: 52.0406,
  lng: -0.7594,
  pricePerSeat: 8.0,
};
