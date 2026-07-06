import { axiosClient } from '../../lib/axios/axios.client.js';
import { ApiResponse } from '../../lib/axios/types.js';

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
  }): Promise<ApiResponse<any>> {
    const params: any = {
      input: payload.input,
      key: process.env.GOOGLE_MAPS_API_KEY,
      components: 'country:ee|country:lv|country:lt',
    };

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
