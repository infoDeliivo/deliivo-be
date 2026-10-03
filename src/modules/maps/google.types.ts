export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface RouteRequest {
  origin: LatLng;
  destination: LatLng;
  waypoints?: LatLng[];
  travelMode?: 'DRIVE' | 'WALK' | 'BICYCLE';
}

export interface RoadsRequest {
  points: LatLng[];
}

export interface WifiAccessPoint {
  macAddress: string; // MAC address of the Wi-Fi access point
  signalStrength?: number; // dBm, optional
  age?: number; // milliseconds since observation, optional
  channel?: number; // Wi-Fi channel, optional
  signalToNoiseRatio?: number; // optional
}

export interface CellTower {
  cellId: number;
  locationAreaCode?: number;
  mobileCountryCode?: number;
  mobileNetworkCode?: number;
  signalStrength?: number;
  timingAdvance?: number;
}

export interface GeolocationRequest {
  considerIp?: boolean;
  wifiAccessPoints?: WifiAccessPoint[];
  cellTowers?: CellTower[];
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface MultiRouteRequest {
  origin: LatLng;
  destination: LatLng;
  travelMode?: 'DRIVE' | 'WALK' | 'BICYCLE' | 'TWO_WHEELER';
  routingPreference?: 'TRAFFIC_AWARE' | 'TRAFFIC_UNAWARE'; // v2 uses this
  departureTime?: string; // ISO string
  computeAlternativeRoutes?: boolean; // true to get multiple routes
}

export interface GeocodeAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export interface GeocodeResult {
  place_id: string;
  formatted_address: string;
  address_components: GeocodeAddressComponent[];
  types: string[];
  geometry: {
    location: { lat: number; lng: number };
  };
}

export interface GeocodeResponse {
  status: string;
  results?: GeocodeResult[];
}

export interface ReverseGeocodedLocality {
  locality: GeocodeResult;
  /** Containing administrative area; named after its seat town (e.g. "Põltsamaa Parish"). */
  adminAreaLevel2: string | null;
  countryCode: string | null;
}
