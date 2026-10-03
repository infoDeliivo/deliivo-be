import { axiosClient } from '../../lib/axios/axios.client.js';
import { ApiResponse } from '../../lib/axios/types.js';
import { GeocodeResponse } from './google.types.js';

export const googleHttp = {
  /**
   * Google Places Autocomplete
   */
  autocomplete(payload: {
    input: string;
    location?: { lat: number; lng: number };
    radius?: number;
    types?: string;
    strictBounds?: boolean;
    scope?: 'baltic' | 'europe';
  }): Promise<ApiResponse<any>> {
    const params: any = {
      input: payload.input,
      key: process.env.GOOGLE_MAPS_API_KEY,
    };

    if (payload.scope !== 'europe') {
      params.components = 'country:ee|country:lv|country:lt';
    }

    if (payload.location) {
      params.location = `${payload.location.lat},${payload.location.lng}`;
      if (payload.radius) {
        params.radius = payload.radius;
        if (payload.strictBounds !== false) params.strictbounds = true;
      }
    }

    if (payload.types) {
      params.types = payload.types;
    }

    return axiosClient.request({
      method: 'GET',
      baseURL: 'https://maps.googleapis.com',
      url: '/maps/api/place/autocomplete/json',
      params,
    });
  },

  /**
   * Get Google Place Details by placeId
   */
  placeDetails(placeId: string): Promise<ApiResponse<any>> {
    return axiosClient.request({
      method: 'GET',
      baseURL: 'https://maps.googleapis.com',
      url: '/maps/api/place/details/json',
      params: {
        place_id: placeId,
        key: process.env.GOOGLE_MAPS_API_KEY,
        fields: 'name,formatted_address,geometry,address_components',
      },
    });
  },

  /**
   * Reverse geocode a coordinate.
   * Used to resolve which localities a route polyline actually passes through.
   * Pass no resultType to get the full result set: restricting to `locality` drops the
   * administrative_area_level_2 component that distinguishes a town from a village.
   * Resolves with the raw Google body — axiosClient.request has no ApiResponse envelope.
   */
  reverseGeocode(payload: {
    lat: number;
    lng: number;
    resultType?: string;
  }): Promise<GeocodeResponse> {
    return axiosClient.request<GeocodeResponse>({
      method: 'GET',
      baseURL: 'https://maps.googleapis.com',
      url: '/maps/api/geocode/json',
      params: {
        latlng: `${payload.lat},${payload.lng}`,
        ...(payload.resultType ? { result_type: payload.resultType } : {}),
        key: process.env.GOOGLE_MAPS_API_KEY,
      },
    });
  },

  /**
   * Forward geocode a place name, optionally restricted to a country.
   * Resolves with the raw Google body — axiosClient.request has no ApiResponse envelope.
   */
  geocodeAddress(payload: {
    address: string;
    countryCode?: string;
  }): Promise<GeocodeResponse> {
    return axiosClient.request<GeocodeResponse>({
      method: 'GET',
      baseURL: 'https://maps.googleapis.com',
      url: '/maps/api/geocode/json',
      params: {
        address: payload.address,
        ...(payload.countryCode ? { components: `country:${payload.countryCode}` } : {}),
        key: process.env.GOOGLE_MAPS_API_KEY,
      },
    });
  },

  /**
   * Google Routes API
   */
  routes(payload: any): Promise<ApiResponse<any>> {
    return axiosClient.request({
      method: 'POST',
      baseURL: 'https://routes.googleapis.com',
      url: '/directions/v2:computeRoutes',
      headers: {
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY!,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline',
      },
      data: payload,
    });
  },

  /**
   * Snap points to roads
   */
  roads(payload: any): Promise<ApiResponse<any>> {
    return axiosClient.request({
      method: 'GET',
      baseURL: 'https://roads.googleapis.com',
      url: '/v1/snapToRoads',
      params: payload,
    });
  },

  /**
   * Geolocate user/device
   */
  geolocation(payload: any): Promise<ApiResponse<any>> {
    return axiosClient.request({
      method: 'POST',
      baseURL: 'https://www.googleapis.com',
      url: '/geolocation/v1/geolocate',
      params: {
        key: process.env.GOOGLE_MAPS_API_KEY,
      },
      data: payload,
    });
  },
};
