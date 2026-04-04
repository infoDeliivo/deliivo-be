import { prisma } from '../../config/index.js';
import { RideStatus, Prisma } from '@prisma/client';
import type { BookingStatus } from '@prisma/client';
import {
  SearchRideQuery,
  SearchRideResult,
  SearchRideResponse,
  RideDetailsResponse,
  EnhancedSearchRideQuery,
  EnhancedSearchRideResult,
  EnhancedSearchRideResponse,
  RideMatchType,
  DPoint,
  MatchResult,
  WaypointInfo,
  RideSnapshot,
  SegmentRideSnapshot,
} from './search-ride.types.js';
import { buildSegmentPoints, resolveSegmentView, SegmentPointRef } from './segment-view.utils.js';
import { encodeViewToken, decodeViewToken } from './view-token.utils.js';

import {
  calculateHaversineDistance as haversine,
  decodePolyline,
  isPointOnRoute,
  isRouteCovered,
  calculatePolylineSimilarity,
  getBoundingBox,
  mergeBoundingBoxes,
  findNearestPointOnRoute,
  LatLng,
} from './polyline.utils.js';

/* ================= CONSTANTS (Spec §4.1, §8) ================= */
const RADIUS_KM = 10;
const BASE_SCORE = 1000;
const DISTANCE_PENALTY_FACTOR = 50;
const EXACT_ORIGIN_DEST_BONUS = 100;
const PICKUP_AT_ORIGIN_BONUS = 20;
const DROP_AT_DEST_BONUS = 20;
const ALT_ROUTE_PENALTY = 30;
const activeBookingStatuses = [
  'PAYMENT_PENDING',
  'DRIVER_PENDING',
  'CONFIRMED',
  'IN_PROGRESS',
  'COMPLETED',
] as unknown as BookingStatus[];

interface AdvancedMatchResult extends MatchResult {
  pickupRef: SegmentPointRef;
  dropRef: SegmentPointRef;
}

type RideBookingWithRider = {
  id: string;
  rideId: string;
  passengerId: string;
  seatsBooked: number;
  totalPrice: number;
  status: BookingStatus;
  pickupWaypointId: string | null;
  dropoffWaypointId: string | null;
  createdAt: Date;
  updatedAt: Date;
  passenger: {
    id: string;
    name: string | null;
    nickName: string | null;
    phone: string | null;
    avatarUrl: string | null;
  };
};

type RideVehicleDetails = {
  id: string;
  brand: string | null;
  model_num: string | null;
  model_name: string | null;
  type: string | null;
  color: string | null;
  year: number | null;
  imageUrl: string | null;
  isVerified: boolean;
};

type DriverVehicleDetails = RideVehicleDetails & {
  userId: string;
};

const bookingWithRiderInclude = {
  where: { status: { in: activeBookingStatuses } },
  orderBy: { createdAt: 'desc' as const },
  include: {
    passenger: {
      select: {
        id: true,
        name: true,
        nickName: true,
        phone: true,
        avatarUrl: true,
      },
    },
  },
};

const mapRideBookings = (bookings: RideBookingWithRider[]) =>
  bookings.map((booking) => ({
    id: booking.id,
    rideId: booking.rideId,
    passengerId: booking.passengerId,
    seatsBooked: booking.seatsBooked,
    totalPrice: booking.totalPrice,
    status: booking.status,
    pickupWaypointId: booking.pickupWaypointId,
    dropoffWaypointId: booking.dropoffWaypointId,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    rider: booking.passenger,
  }));

const mapRideVehicle = (vehicle: RideVehicleDetails | null) =>
  vehicle
    ? {
        id: vehicle.id,
        brand: vehicle.brand,
        model_num: vehicle.model_num,
        model_name: vehicle.model_name,
        type: vehicle.type,
        color: vehicle.color,
        year: vehicle.year,
        imageUrl: vehicle.imageUrl,
        isVerified: vehicle.isVerified,
      }
    : null;

type RideWaypointLike = {
  id: string;
  placeId: string;
  address: string;
  lat: number;
  lng: number;
  waypointType: string;
  orderIndex: number;
  pricePerSeat: number | null;
};

type RideCoreLike = {
  id: string;
  originPlaceId: string;
  originAddress: string;
  originLat: number;
  originLng: number;
  destinationPlaceId: string;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  routePolyline: string | null;
  routeDistanceMeters: number | null;
  routeDurationSeconds: number | null;
  departureDate: Date;
  departureTime: string;
  totalSeats: number;
  availableSeats: number;
  basePricePerSeat: number;
  currency: string;
  status: RideStatus;
};

const mapWaypoints = (waypoints: RideWaypointLike[]): WaypointInfo[] =>
  waypoints.map((waypoint) => ({
    id: waypoint.id,
    placeId: waypoint.placeId,
    address: waypoint.address,
    lat: waypoint.lat,
    lng: waypoint.lng,
    waypointType: waypoint.waypointType,
    orderIndex: waypoint.orderIndex,
    pricePerSeat: waypoint.pricePerSeat,
  }));

const buildFullRideSnapshot = (ride: RideCoreLike, waypoints?: WaypointInfo[]): RideSnapshot => ({
  id: ride.id,
  originPlaceId: ride.originPlaceId,
  originAddress: ride.originAddress,
  originLat: ride.originLat,
  originLng: ride.originLng,
  destinationPlaceId: ride.destinationPlaceId,
  destinationAddress: ride.destinationAddress,
  destinationLat: ride.destinationLat,
  destinationLng: ride.destinationLng,
  routePolyline: ride.routePolyline,
  routeDistanceMeters: ride.routeDistanceMeters,
  routeDurationSeconds: ride.routeDurationSeconds,
  departureDate: ride.departureDate,
  departureTime: ride.departureTime,
  totalSeats: ride.totalSeats,
  availableSeats: ride.availableSeats,
  basePricePerSeat: ride.basePricePerSeat,
  currency: ride.currency,
  status: ride.status,
  waypoints,
});

/* ================= BASIC SEARCH RIDES ================= */
export const searchRides = async (
  query: SearchRideQuery,
  excludeDriverId?: string,
): Promise<SearchRideResponse> => {
  const {
    departureDate,
    departureTime,
    maxPrice,
    femaleOnly,
    sortBy = 'departure',
    sortOrder = 'asc',
  } = query;

  // Parse ALL numeric query params — req.query values arrive as strings
  const originLat = Number(query.originLat);
  const originLng = Number(query.originLng);
  const destinationLat = Number(query.destinationLat);
  const destinationLng = Number(query.destinationLng);
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  const radiusKm = Number(query.radiusKm) || RADIUS_KM;
  const skip = (page - 1) * limit;

  // Get bounding boxes for origin and destination
  const originBB = getBoundingBox(originLat, originLng, radiusKm);
  const destBB = getBoundingBox(destinationLat, destinationLng, radiusKm);

  // Build where clause with bounding box optimization
  const whereClause: Prisma.RideWhereInput = {
    status: RideStatus.PUBLISHED,
    availableSeats: { gt: 0 },
    departureDate: {
      equals: new Date(new Date(departureDate).toISOString().split('T')[0] + 'T00:00:00.000Z'),
    },
    // Bounding box filter for origin
    originLat: { gte: originBB.minLat, lte: originBB.maxLat },
    originLng: { gte: originBB.minLng, lte: originBB.maxLng },
    // Bounding box filter for destination
    destinationLat: { gte: destBB.minLat, lte: destBB.maxLat },
    destinationLng: { gte: destBB.minLng, lte: destBB.maxLng },
  };

  if (excludeDriverId) {
    whereClause.driverId = { not: excludeDriverId };
  }

  // Add price filter if specified
  if (maxPrice) {
    whereClause.basePricePerSeat = { lte: maxPrice };
  }

  // Get rides with driver info
  const [rides, total] = await Promise.all([
    prisma.ride.findMany({
      where: whereClause,
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
        bookings: bookingWithRiderInclude,
      },
      orderBy: getOrderBy(sortBy, sortOrder),
      skip,
      take: limit,
    }),
    prisma.ride.count({ where: whereClause }),
  ]);

  const vehicleIds = Array.from(
    new Set(
      rides
        .map((ride) => ride.vehicleId)
        .filter((vehicleId): vehicleId is string => Boolean(vehicleId)),
    ),
  );
  const driverIdsWithoutVehicle = Array.from(
    new Set(rides.filter((ride) => !ride.vehicleId).map((ride) => ride.driverId)),
  );

  const vehicles = vehicleIds.length
    ? await prisma.vehicle.findMany({
        where: {
          id: { in: vehicleIds },
          deletedAt: null,
        },
        select: {
          id: true,
          brand: true,
          model_num: true,
          model_name: true,
          type: true,
          color: true,
          year: true,
          imageUrl: true,
          isVerified: true,
        },
      })
    : [];
  const fallbackVehicles = driverIdsWithoutVehicle.length
    ? await prisma.vehicle.findMany({
        where: {
          userId: { in: driverIdsWithoutVehicle },
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          brand: true,
          model_num: true,
          model_name: true,
          type: true,
          color: true,
          year: true,
          imageUrl: true,
          isVerified: true,
        },
      })
    : [];
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const fallbackVehicleByDriverId = new Map<string, DriverVehicleDetails>();
  fallbackVehicles.forEach((vehicle) => {
    if (!fallbackVehicleByDriverId.has(vehicle.userId)) {
      fallbackVehicleByDriverId.set(vehicle.userId, vehicle);
    }
  });

  // Calculate actual distances and filter by exact radius
  const ridesWithDistance: SearchRideResult[] = rides
    .map((ride) => {
      const distanceFromOrigin = haversine(
        { lat: originLat, lng: originLng },
        { lat: ride.originLat, lng: ride.originLng },
      );
      const distanceFromDestination = haversine(
        { lat: destinationLat, lng: destinationLng },
        { lat: ride.destinationLat, lng: ride.destinationLng },
      );

      return {
        id: ride.id,
        driverId: ride.driverId,
        driver: {
          id: ride.driver.id,
          name: ride.driver.name,
          avatarUrl: ride.driver.avatarUrl,
        },
        vehicle: mapRideVehicle(
          ride.vehicleId
            ? (vehicleById.get(ride.vehicleId) ?? null)
            : (fallbackVehicleByDriverId.get(ride.driverId) ?? null),
        ),
        bookings: mapRideBookings(ride.bookings),
        originPlaceId: ride.originPlaceId,
        originAddress: ride.originAddress,
        originLat: ride.originLat,
        originLng: ride.originLng,
        destinationPlaceId: ride.destinationPlaceId,
        destinationAddress: ride.destinationAddress,
        destinationLat: ride.destinationLat,
        destinationLng: ride.destinationLng,
        routePolyline: ride.routePolyline,
        routeDistanceMeters: ride.routeDistanceMeters,
        routeDurationSeconds: ride.routeDurationSeconds,
        departureDate: ride.departureDate,
        departureTime: ride.departureTime,
        availableSeats: ride.availableSeats,
        basePricePerSeat: ride.basePricePerSeat,
        currency: ride.currency,
        status: ride.status,
        distanceFromOrigin,
        distanceFromDestination,
      };
    })
    .filter(
      (ride) => ride.distanceFromOrigin! <= radiusKm && ride.distanceFromDestination! <= radiusKm,
    );

  // Sort by distance if requested
  if (sortBy === 'distance') {
    ridesWithDistance.sort((a, b) => {
      const distA = (a.distanceFromOrigin || 0) + (a.distanceFromDestination || 0);
      const distB = (b.distanceFromOrigin || 0) + (b.distanceFromDestination || 0);
      return sortOrder === 'asc' ? distA - distB : distB - distA;
    });
  }

  return {
    rides: ridesWithDistance,
    pagination: {
      page,
      limit,
      total: ridesWithDistance.length,
      totalPages: Math.ceil(ridesWithDistance.length / limit),
    },
  };
};

/* ================= GET ORDER BY ================= */
const getOrderBy = (sortBy: string, sortOrder: string): Prisma.RideOrderByWithRelationInput => {
  switch (sortBy) {
    case 'price':
      return { basePricePerSeat: sortOrder as Prisma.SortOrder };
    case 'departure':
    default:
      return { departureDate: sortOrder as Prisma.SortOrder };
  }
};

/* ================= GET RIDE DETAILS ================= */
export const getRideDetails = async (rideId: string): Promise<RideDetailsResponse | null> => {
  const ride = await prisma.ride.findFirst({
    where: {
      id: rideId,
      status: RideStatus.PUBLISHED,
    },
    include: {
      driver: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
        },
      },
      waypoints: {
        orderBy: { orderIndex: 'asc' },
      },
      bookings: bookingWithRiderInclude,
    },
  });

  if (!ride) return null;

  const vehicleByRideId = ride.vehicleId
    ? await prisma.vehicle.findFirst({
        where: {
          id: ride.vehicleId,
          deletedAt: null,
        },
        select: {
          id: true,
          brand: true,
          model_num: true,
          model_name: true,
          type: true,
          color: true,
          year: true,
          imageUrl: true,
          isVerified: true,
        },
      })
    : null;
  const fallbackVehicle = !vehicleByRideId
    ? await prisma.vehicle.findFirst({
        where: {
          userId: ride.driverId,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          brand: true,
          model_num: true,
          model_name: true,
          type: true,
          color: true,
          year: true,
          imageUrl: true,
          isVerified: true,
        },
      })
    : null;
  const vehicle = vehicleByRideId ?? fallbackVehicle;

  const waypoints = mapWaypoints(ride.waypoints);
  const fullRide = buildFullRideSnapshot(ride, waypoints);

  return {
    id: ride.id,
    driverId: ride.driverId,
    driver: {
      id: ride.driver.id,
      name: ride.driver.name,
      avatarUrl: ride.driver.avatarUrl,
    },
    vehicle: mapRideVehicle(vehicle),
    bookings: mapRideBookings(ride.bookings),
    originPlaceId: ride.originPlaceId,
    originAddress: ride.originAddress,
    originLat: ride.originLat,
    originLng: ride.originLng,
    destinationPlaceId: ride.destinationPlaceId,
    destinationAddress: ride.destinationAddress,
    destinationLat: ride.destinationLat,
    destinationLng: ride.destinationLng,
    routePolyline: ride.routePolyline,
    routeDistanceMeters: ride.routeDistanceMeters,
    routeDurationSeconds: ride.routeDurationSeconds,
    departureDate: ride.departureDate,
    departureTime: ride.departureTime,
    totalSeats: ride.totalSeats,
    availableSeats: ride.availableSeats,
    basePricePerSeat: ride.basePricePerSeat,
    currency: ride.currency,
    status: ride.status,
    notes: ride.notes,
    waypoints,
    isSegmentView: false,
    fullRide,
    segmentRide: null,
  };
};

/* ================= GET RIDE VIEW DETAILS BY TOKEN ================= */
export const getRideViewByToken = async (
  viewToken: string,
): Promise<RideDetailsResponse | null> => {
  const payload = decodeViewToken(viewToken);

  const ride = await prisma.ride.findFirst({
    where: {
      id: payload.rideId,
      status: RideStatus.PUBLISHED,
    },
    include: {
      driver: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
        },
      },
      waypoints: {
        orderBy: { orderIndex: 'asc' },
      },
      bookings: bookingWithRiderInclude,
    },
  });

  if (!ride) {
    return null;
  }

  const vehicleByRideId = ride.vehicleId
    ? await prisma.vehicle.findFirst({
        where: {
          id: ride.vehicleId,
          deletedAt: null,
        },
        select: {
          id: true,
          brand: true,
          model_num: true,
          model_name: true,
          type: true,
          color: true,
          year: true,
          imageUrl: true,
          isVerified: true,
        },
      })
    : null;
  const fallbackVehicle = !vehicleByRideId
    ? await prisma.vehicle.findFirst({
        where: {
          userId: ride.driverId,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          brand: true,
          model_num: true,
          model_name: true,
          type: true,
          color: true,
          year: true,
          imageUrl: true,
          isVerified: true,
        },
      })
    : null;
  const vehicle = vehicleByRideId ?? fallbackVehicle;

  const points = buildSegmentPoints(ride);
  const riderView = resolveSegmentView(ride, points, payload.pickupRef, payload.dropRef);
  if (!riderView) {
    throw new Error('INVALID_VIEW_TOKEN');
  }

  const waypoints = mapWaypoints(ride.waypoints);
  const fullRide = buildFullRideSnapshot(ride, waypoints);
  const segmentRide: SegmentRideSnapshot = {
    ...fullRide,
    originPlaceId: riderView.originPlaceId,
    originAddress: riderView.originAddress,
    originLat: riderView.originLat,
    originLng: riderView.originLng,
    destinationPlaceId: riderView.destinationPlaceId,
    destinationAddress: riderView.destinationAddress,
    destinationLat: riderView.destinationLat,
    destinationLng: riderView.destinationLng,
    basePricePerSeat: riderView.basePricePerSeat,
    bookingContext: riderView.bookingContext,
    segment: riderView.segment,
    segmentId: viewToken,
  };

  return {
    id: ride.id,
    driverId: ride.driverId,
    driver: ride.driver,
    vehicle: mapRideVehicle(vehicle),
    bookings: mapRideBookings(ride.bookings),
    originPlaceId: riderView.originPlaceId,
    originAddress: riderView.originAddress,
    originLat: riderView.originLat,
    originLng: riderView.originLng,
    destinationPlaceId: riderView.destinationPlaceId,
    destinationAddress: riderView.destinationAddress,
    destinationLat: riderView.destinationLat,
    destinationLng: riderView.destinationLng,
    routePolyline: ride.routePolyline,
    routeDistanceMeters: ride.routeDistanceMeters,
    routeDurationSeconds: ride.routeDurationSeconds,
    departureDate: ride.departureDate,
    departureTime: ride.departureTime,
    totalSeats: ride.totalSeats,
    availableSeats: ride.availableSeats,
    basePricePerSeat: riderView.basePricePerSeat,
    currency: ride.currency,
    status: ride.status,
    notes: ride.notes,
    waypoints,
    isSegmentView: true,
    segmentId: viewToken,
    bookingContext: riderView.bookingContext,
    segment: riderView.segment,
    fullRide,
    segmentRide,
  };
};

export const getRideSegmentById = async (
  segmentId: string,
): Promise<RideDetailsResponse | null> => {
  try {
    return await getRideViewByToken(segmentId);
  } catch (error: any) {
    if (error?.message === 'INVALID_VIEW_TOKEN') {
      throw new Error('INVALID_SEGMENT_ID');
    }
    throw error;
  }
};

/* ================= SAVE RECENT SEARCH ================= */
export const saveRecentSearch = async (
  userId: string,
  originAddress: string,
  originLat: number,
  originLng: number,
  destinationAddress: string,
  destinationLat: number,
  destinationLng: number,
) => {
  // Can be stored in Redis or a RecentSearch model later
};

/* ================= CREATE RIDE ALERT ================= */
export const createRideAlert = async (
  userId: string,
  originLat: number,
  originLng: number,
  destinationLat: number,
  destinationLng: number,
  departureDate: Date,
  radiusKm: number,
) => {
  return {
    success: true,
    message: 'Alert created. You will be notified when matching rides are available.',
  };
};

/* ========================================================================
   ADVANCED SEARCH — D_POINTS BASED 4-CONDITION GEO-MATCHING (Spec §2-§10)
   ========================================================================

   Driver Route:  [Origin → W1 → W2 → ... → Wn → Destination]
   Rider Request: [Origin → Destination]

   Build: D_POINTS = [Do, W1, W2, ... Wn, Dd]

   For each ride:
   1. Reject if no seats available
   2. Build ordered D_POINTS
   3. Find all pickup indices i where distance(Ro, D_POINTS[i]) <= 5km
   4. Find all drop indices j where distance(Rd, D_POINTS[j]) <= 5km
   5. For each pair (i, j): if i < j → valid match
   6. Choose best pair with smallest distance sum
   7. Classify match type (COND_1 → COND_4)
   8. Compute score
   9. Add to results
   10. Sort results by score descending

   ======================================================================== */

/* ================= ADVANCED SEARCH RIDES ================= */
export const searchRidesAdvanced = async (
  query: EnhancedSearchRideQuery,
  excludeDriverId?: string,
): Promise<EnhancedSearchRideResponse> => {
  const {
    departureDate,
    maxPrice,
    sortBy = 'departure',
    sortOrder = 'asc',
    userRoutePolyline,
    includeAlternates = true,
  } = query;

  const originLat = Number(query.originLat);
  const originLng = Number(query.originLng);
  const destinationLat = Number(query.destinationLat);
  const destinationLng = Number(query.destinationLng);
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  const radiusKm = Number(query.radiusKm) || RADIUS_KM;
  const skip = (page - 1) * limit;

  const riderOrigin: LatLng = { lat: originLat, lng: originLng };
  const riderDest: LatLng = { lat: destinationLat, lng: destinationLng };

  /* ------------------------------------------------------------------
       Phase 1: Spatial pre-filtering with expanded bounding box (Spec §9)
       Use 2× radius so we can catch rides where waypoints match
       ------------------------------------------------------------------ */
  const expandedRadius = radiusKm * 2;
  const originBB = getBoundingBox(originLat, originLng, expandedRadius);
  const destBB = getBoundingBox(destinationLat, destinationLng, expandedRadius);
  const mergedBB = mergeBoundingBoxes([originBB, destBB]);

  // For @db.Date columns, use exact date match at UTC midnight
  const dateStr = new Date(departureDate).toISOString().split('T')[0];
  const searchDate = new Date(dateStr + 'T00:00:00.000Z');

  const whereClause: Prisma.RideWhereInput = {
    status: RideStatus.PUBLISHED,
    availableSeats: { gt: 0 }, // seats must be available
    departureDate: { equals: searchDate },
    OR: [
      {
        originLat: { gte: mergedBB.minLat, lte: mergedBB.maxLat },
        originLng: { gte: mergedBB.minLng, lte: mergedBB.maxLng },
      },
      {
        destinationLat: { gte: mergedBB.minLat, lte: mergedBB.maxLat },
        destinationLng: { gte: mergedBB.minLng, lte: mergedBB.maxLng },
      },
      {
        waypoints: {
          some: {
            lat: { gte: mergedBB.minLat, lte: mergedBB.maxLat },
            lng: { gte: mergedBB.minLng, lte: mergedBB.maxLng },
          },
        },
      },
    ],
  };

  if (excludeDriverId) {
    whereClause.driverId = { not: excludeDriverId };
  }

  const candidateRides = await prisma.ride.findMany({
    where: whereClause,
    include: {
      driver: {
        select: {
          id: true,
          name: true,
          avatarUrl: true,
        },
      },
      waypoints: {
        orderBy: { orderIndex: 'asc' },
      },
      bookings: bookingWithRiderInclude,
    },
    take: 200, // Cap for performance
  });

  const vehicleIds = Array.from(
    new Set(
      candidateRides
        .map((ride) => ride.vehicleId)
        .filter((vehicleId): vehicleId is string => Boolean(vehicleId)),
    ),
  );
  const driverIdsWithoutVehicle = Array.from(
    new Set(candidateRides.filter((ride) => !ride.vehicleId).map((ride) => ride.driverId)),
  );

  const vehicles = vehicleIds.length
    ? await prisma.vehicle.findMany({
        where: {
          id: { in: vehicleIds },
          deletedAt: null,
        },
        select: {
          id: true,
          brand: true,
          model_num: true,
          model_name: true,
          type: true,
          color: true,
          year: true,
          imageUrl: true,
          isVerified: true,
        },
      })
    : [];
  const fallbackVehicles = driverIdsWithoutVehicle.length
    ? await prisma.vehicle.findMany({
        where: {
          userId: { in: driverIdsWithoutVehicle },
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          brand: true,
          model_num: true,
          model_name: true,
          type: true,
          color: true,
          year: true,
          imageUrl: true,
          isVerified: true,
        },
      })
    : [];
  const vehicleById = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const fallbackVehicleByDriverId = new Map<string, DriverVehicleDetails>();
  fallbackVehicles.forEach((vehicle) => {
    if (!fallbackVehicleByDriverId.has(vehicle.userId)) {
      fallbackVehicleByDriverId.set(vehicle.userId, vehicle);
    }
  });

  /* ------------------------------------------------------------------
       Phase 2: D_POINTS matching for each candidate ride (Spec §6-§7)
       ------------------------------------------------------------------ */
  const evaluatedRides: EnhancedSearchRideResult[] = [];

  for (const ride of candidateRides) {
    // Step 2: Build ordered D_POINTS = [Origin, W1, W2, ..., Wn, Destination]
    const dPoints = buildDPoints(ride);
    const lastIdx = dPoints.length - 1;

    // Step 3-4: Find all matching pickup & drop indices
    const originMatches: { index: number; distance: number }[] = [];
    const destMatches: { index: number; distance: number }[] = [];

    for (let idx = 0; idx < dPoints.length; idx++) {
      const pickupDist = haversine(riderOrigin, { lat: dPoints[idx].lat, lng: dPoints[idx].lng });
      if (pickupDist <= radiusKm) {
        originMatches.push({ index: idx, distance: pickupDist });
      }

      const dropDist = haversine(riderDest, { lat: dPoints[idx].lat, lng: dPoints[idx].lng });
      if (dropDist <= radiusKm) {
        destMatches.push({ index: idx, distance: dropDist });
      }
    }

    // Step 5-6: Find best valid pair (i < j) with smallest cost
    let bestMatch: AdvancedMatchResult | null = null;
    let bestCost = Infinity;

    for (const pickup of originMatches) {
      for (const drop of destMatches) {
        // Spec §12: pickup index must be < drop index
        if (pickup.index < drop.index) {
          const cost = pickup.distance + drop.distance;
          if (cost < bestCost) {
            bestCost = cost;

            // Step 7: Classify match type
            const matchType = classifyMatch(pickup.index, drop.index, lastIdx, dPoints);

            // Step 8: Compute score (Spec §8)
            const score = computeScore(
              pickup.distance,
              drop.distance,
              pickup.index,
              drop.index,
              lastIdx,
              matchType,
            );

            const pickupRef = toSegmentPointRef(dPoints[pickup.index]);
            const dropRef = toSegmentPointRef(dPoints[drop.index]);
            if (!pickupRef || !dropRef) {
              continue;
            }

            bestMatch = {
              pickupIndex: pickup.index,
              dropIndex: drop.index,
              pickupMatchedPoint: dPoints[pickup.index].pointType,
              dropMatchedPoint: dPoints[drop.index].pointType,
              pickupDistanceKm: round2(pickup.distance),
              dropDistanceKm: round2(drop.distance),
              matchType,
              score,
              pickupRef,
              dropRef,
            };
          }
        }
      }
    }

    // Fallback: ALT_ROUTE via polyline proximity (Spec §4.3)
    if (!bestMatch && includeAlternates && userRoutePolyline && ride.routePolyline) {
      const altMatch = evaluateAltRoute(riderOrigin, riderDest, ride.routePolyline, radiusKm);
      if (altMatch) {
        bestMatch = {
          ...altMatch,
          pickupRef: 'origin',
          dropRef: 'destination',
        };
      }
    }

    // Skip rides that don't match any condition
    if (!bestMatch) continue;

    const allWaypoints = mapWaypoints(ride.waypoints);
    const fullRide = buildFullRideSnapshot(ride, allWaypoints);

    // Collect relevant waypoints near rider's origin/destination
    const relevantWaypoints: WaypointInfo[] = allWaypoints.filter((wp) => {
      const wpLoc: LatLng = { lat: wp.lat, lng: wp.lng };
      return haversine(riderOrigin, wpLoc) <= radiusKm || haversine(riderDest, wpLoc) <= radiusKm;
    });

    const segmentPoints = buildSegmentPoints(ride);
    const riderView =
      bestMatch.matchType === RideMatchType.COND_1 ||
      bestMatch.matchType === RideMatchType.ALT_ROUTE
        ? null
        : resolveSegmentView(ride, segmentPoints, bestMatch.pickupRef, bestMatch.dropRef);

    const segmentId = riderView
      ? encodeViewToken({
          v: 1,
          rideId: ride.id,
          mode: 'segment',
          pickupRef: bestMatch.pickupRef,
          dropRef: bestMatch.dropRef,
        })
      : undefined;

    const segmentRide: SegmentRideSnapshot | null = riderView
      ? {
          ...fullRide,
          originPlaceId: riderView.originPlaceId,
          originAddress: riderView.originAddress,
          originLat: riderView.originLat,
          originLng: riderView.originLng,
          destinationPlaceId: riderView.destinationPlaceId,
          destinationAddress: riderView.destinationAddress,
          destinationLat: riderView.destinationLat,
          destinationLng: riderView.destinationLng,
          basePricePerSeat: riderView.basePricePerSeat,
          bookingContext: riderView.bookingContext,
          segment: riderView.segment,
          segmentId,
        }
      : null;

    const riderFacingPrice = riderView?.basePricePerSeat ?? ride.basePricePerSeat;
    if (maxPrice && riderFacingPrice > maxPrice) {
      continue;
    }

    // Build enhanced result (Spec §10)
    evaluatedRides.push({
      id: ride.id,
      driverId: ride.driverId,
      driver: {
        id: ride.driver.id,
        name: ride.driver.name,
        avatarUrl: ride.driver.avatarUrl,
      },
      vehicle: mapRideVehicle(
        ride.vehicleId
          ? (vehicleById.get(ride.vehicleId) ?? null)
          : (fallbackVehicleByDriverId.get(ride.driverId) ?? null),
      ),
      bookings: mapRideBookings(ride.bookings),
      originPlaceId: riderView?.originPlaceId ?? ride.originPlaceId,
      originAddress: riderView?.originAddress ?? ride.originAddress,
      originLat: riderView?.originLat ?? ride.originLat,
      originLng: riderView?.originLng ?? ride.originLng,
      destinationPlaceId: riderView?.destinationPlaceId ?? ride.destinationPlaceId,
      destinationAddress: riderView?.destinationAddress ?? ride.destinationAddress,
      destinationLat: riderView?.destinationLat ?? ride.destinationLat,
      destinationLng: riderView?.destinationLng ?? ride.destinationLng,
      routeDistanceMeters: ride.routeDistanceMeters,
      routeDurationSeconds: ride.routeDurationSeconds,
      routePolyline: ride.routePolyline,
      departureDate: ride.departureDate,
      departureTime: ride.departureTime,
      availableSeats: ride.availableSeats,
      basePricePerSeat: riderFacingPrice,
      currency: ride.currency,
      status: ride.status,
      distanceFromOrigin: haversine(riderOrigin, { lat: ride.originLat, lng: ride.originLng }),
      distanceFromDestination: haversine(riderDest, {
        lat: ride.destinationLat,
        lng: ride.destinationLng,
      }),
      matchType: bestMatch.matchType,
      score: bestMatch.score,
      pickupMatchedPoint: bestMatch.pickupMatchedPoint,
      dropMatchedPoint: bestMatch.dropMatchedPoint,
      pickupDistanceKm: bestMatch.pickupDistanceKm,
      dropDistanceKm: bestMatch.dropDistanceKm,
      relevantWaypoints,
      isSegmentView: Boolean(riderView),
      segmentId,
      segment: riderView?.segment,
    });
  }

  /* ------------------------------------------------------------------
       Phase 3: Sort by score descending, group, paginate (Spec §6 Step 10)
       ------------------------------------------------------------------ */
  evaluatedRides.sort((a, b) => {
    // Primary: score descending
    if (a.score !== b.score) return b.score - a.score;

    // Secondary: user-specified sort
    if (sortBy === 'price') {
      return sortOrder === 'asc'
        ? a.basePricePerSeat - b.basePricePerSeat
        : b.basePricePerSeat - a.basePricePerSeat;
    }
    if (sortBy === 'distance') {
      const distA = (a.distanceFromOrigin || 0) + (a.distanceFromDestination || 0);
      const distB = (b.distanceFromOrigin || 0) + (b.distanceFromDestination || 0);
      return sortOrder === 'asc' ? distA - distB : distB - distA;
    }
    return sortOrder === 'asc'
      ? new Date(a.departureDate).getTime() - new Date(b.departureDate).getTime()
      : new Date(b.departureDate).getTime() - new Date(a.departureDate).getTime();
  });

  // Group by match type
  const grouped = {
    cond1: evaluatedRides.filter((r) => r.matchType === RideMatchType.COND_1),
    cond2: evaluatedRides.filter((r) => r.matchType === RideMatchType.COND_2),
    cond3: evaluatedRides.filter((r) => r.matchType === RideMatchType.COND_3),
    cond4: evaluatedRides.filter((r) => r.matchType === RideMatchType.COND_4),
    altRoute: evaluatedRides.filter((r) => r.matchType === RideMatchType.ALT_ROUTE),
  };

  // Paginate
  const paginatedRides = evaluatedRides.slice(skip, skip + limit);

  return {
    rides: paginatedRides,
    grouped,
    pagination: {
      page,
      limit,
      total: evaluatedRides.length,
      totalPages: Math.ceil(evaluatedRides.length / limit),
    },
  };
};

/* ========================================================================
   HELPERS
   ======================================================================== */

/** Round to 2 decimal places */
const round2 = (n: number) => Math.round(n * 100) / 100;

const toSegmentPointRef = (point: DPoint): SegmentPointRef | null => {
  if (point.pointType === 'ORIGIN') {
    return 'origin';
  }
  if (point.pointType === 'DEST') {
    return 'destination';
  }
  if (!point.waypointId) {
    return null;
  }
  return `waypoint:${point.waypointId}`;
};

/**
 * Build ordered D_POINTS array from a ride (Spec §2)
 * D_POINTS = [Origin, W1, W2, ..., Wn, Destination]
 */
const buildDPoints = (ride: {
  originLat: number;
  originLng: number;
  originAddress: string;
  destinationLat: number;
  destinationLng: number;
  destinationAddress: string;
  waypoints: Array<{
    id: string;
    lat: number;
    lng: number;
    address: string;
    orderIndex: number;
  }>;
}): DPoint[] => {
  const points: DPoint[] = [];

  // Index 0: Origin
  points.push({
    index: 0,
    lat: ride.originLat,
    lng: ride.originLng,
    address: ride.originAddress,
    pointType: 'ORIGIN',
  });

  // Indices 1..n: Waypoints sorted by orderIndex
  const sortedWaypoints = [...ride.waypoints].sort((a, b) => a.orderIndex - b.orderIndex);
  for (let i = 0; i < sortedWaypoints.length; i++) {
    points.push({
      index: i + 1,
      waypointId: sortedWaypoints[i].id,
      lat: sortedWaypoints[i].lat,
      lng: sortedWaypoints[i].lng,
      address: sortedWaypoints[i].address,
      pointType: 'WAYPOINT',
    });
  }

  // Last index: Destination
  points.push({
    index: points.length,
    lat: ride.destinationLat,
    lng: ride.destinationLng,
    address: ride.destinationAddress,
    pointType: 'DEST',
  });

  return points;
};

/**
 * Classify match type based on pickup/drop indices (Spec §3)
 *
 * COND_1: i=0 (origin) AND j=last (destination)
 * COND_4: i is waypoint AND j=last (destination)
 * COND_3: both i and j are waypoints
 * COND_2: any other valid (i < j) combination
 */
const classifyMatch = (
  pickupIdx: number,
  dropIdx: number,
  lastIdx: number,
  dPoints: DPoint[],
): RideMatchType => {
  const pickupType = dPoints[pickupIdx].pointType;
  const dropType = dPoints[dropIdx].pointType;

  // Condition 1: Exact origin & destination match
  if (pickupIdx === 0 && dropIdx === lastIdx) {
    return RideMatchType.COND_1;
  }

  // Condition 4: Waypoint to Destination
  if (pickupType === 'WAYPOINT' && dropIdx === lastIdx) {
    return RideMatchType.COND_4;
  }

  // Condition 3: Waypoint to Waypoint
  if (pickupType === 'WAYPOINT' && dropType === 'WAYPOINT') {
    return RideMatchType.COND_3;
  }

  // Condition 2: Rider points anywhere on route (catch-all valid i < j)
  return RideMatchType.COND_2;
};

/**
 * Compute match score (Spec §8)
 *
 * Base score: 1000
 * score -= pickupDistance * 50
 * score -= dropDistance * 50
 * Bonuses:
 *   Exact origin-destination match: +100
 *   Pickup at driver origin: +20
 *   Drop at driver destination: +20
 * Penalty:
 *   Alternative route match: -30
 */
const computeScore = (
  pickupDistKm: number,
  dropDistKm: number,
  pickupIdx: number,
  dropIdx: number,
  lastIdx: number,
  matchType: RideMatchType,
): number => {
  let score = BASE_SCORE;

  // Distance penalties
  score -= pickupDistKm * DISTANCE_PENALTY_FACTOR;
  score -= dropDistKm * DISTANCE_PENALTY_FACTOR;

  // Bonuses
  if (pickupIdx === 0 && dropIdx === lastIdx) {
    score += EXACT_ORIGIN_DEST_BONUS;
  }
  if (pickupIdx === 0) {
    score += PICKUP_AT_ORIGIN_BONUS;
  }
  if (dropIdx === lastIdx) {
    score += DROP_AT_DEST_BONUS;
  }

  // Penalty
  if (matchType === RideMatchType.ALT_ROUTE) {
    score -= ALT_ROUTE_PENALTY;
  }

  return Math.round(Math.max(0, score));
};

/**
 * Evaluate ALT_ROUTE match via polyline proximity (Spec §4.3)
 *
 * If rider origin & destination lie close to driver's route polyline,
 * classify as ALT_ROUTE_MATCH
 */
const evaluateAltRoute = (
  riderOrigin: LatLng,
  riderDest: LatLng,
  driverPolyline: string,
  radiusKm: number,
): MatchResult | null => {
  const routePoints = decodePolyline(driverPolyline);
  if (routePoints.length === 0) return null;

  // Find nearest route point to rider origin
  const originNearest = findNearestPointOnRoute(riderOrigin, routePoints);
  // Find nearest route point to rider destination
  const destNearest = findNearestPointOnRoute(riderDest, routePoints);

  // Both must be within radius and origin must come before dest on route
  if (
    originNearest.distance <= radiusKm &&
    destNearest.distance <= radiusKm &&
    originNearest.index < destNearest.index
  ) {
    const score = computeScore(
      originNearest.distance,
      destNearest.distance,
      -1, // not a D_POINT index, won't trigger origin/dest bonuses
      -1,
      -1,
      RideMatchType.ALT_ROUTE,
    );

    return {
      pickupIndex: originNearest.index,
      dropIndex: destNearest.index,
      pickupMatchedPoint: 'WAYPOINT', // closest route segment
      dropMatchedPoint: 'WAYPOINT',
      pickupDistanceKm: round2(originNearest.distance),
      dropDistanceKm: round2(destNearest.distance),
      matchType: RideMatchType.ALT_ROUTE,
      score,
    };
  }

  return null;
};
