// validators/googleSchemas.ts
import { z } from 'zod';

// Schema for lat/lng point
const LatLngSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
});

// /routes/compute
export const computeRouteSchema = z.object({
  origin: LatLngSchema,
  destination: LatLngSchema,
  waypoints: z.array(LatLngSchema).optional(),
  travelMode: z.enum(['DRIVE', 'WALK', 'BICYCLE', 'TRANSIT']).optional(),
});

// /routes/multi
export const multiRouteSchema = computeRouteSchema.extend({
  computeAlternativeRoutes: z.boolean().optional(),
  routingPreference: z
    .enum(['TRAFFIC_UNAWARE', 'TRAFFIC_AWARE', 'TRAFFIC_AWARE_OPTIMAL'])
    .optional(),
  departureTime: z.string().optional(), // ISO timestamp if needed
});

// /roads/snap
export const snapRoadsSchema = z.object({
  points: z.array(
    z.object({
      latitude: z.number(),
      longitude: z.number(),
    }),
  ),
});

// /geolocation
const WifiAccessPointSchema = z.object({
  macAddress: z.string(),
  signalStrength: z.number(),
  age: z.number().optional(),
  channel: z.number().optional(),
});

// Cell Tower schema
const CellTowerSchema = z.object({
  cellId: z.number(),
  locationAreaCode: z.number(),
  mobileCountryCode: z.number(),
  mobileNetworkCode: z.number(),
  signalStrength: z.number(),
});

// Complete geolocation request schema
export const geolocationSchema = z.object({
  considerIp: z.boolean().optional(),
  wifiAccessPoints: z.array(WifiAccessPointSchema).optional(),
  cellTowers: z.array(CellTowerSchema).optional(),
});

export const autocompleteSchema = z.object({
  input: z.string().min(1, 'Input is required'),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius: z.coerce.number().min(1).max(50000).optional(),
  strictBounds: z.enum(['true', 'false']).optional(),
  types: z.string().optional(),
  scope: z.enum(['baltic', 'europe']).optional(),
}).refine((value) => (value.lat === undefined) === (value.lng === undefined), {
  message: 'lat and lng must be provided together',
  path: ['lat'],
});

/**
 * Place details validation
 * - placeId: required string
 */
export const placeDetailsSchema = z.object({
  placeId: z.string().min(1, 'Place ID is required'),
});
