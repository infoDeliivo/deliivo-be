import axios, { AxiosInstance, AxiosResponse } from 'axios';

export const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

/**
 * Unauthenticated axios instance. All status codes are returned as responses
 * (validateStatus: always true) so tests can assert on error codes without
 * axios throwing.
 */
export const api: AxiosInstance = axios.create({
  baseURL: `${BASE_URL}/api/v1`,
  timeout: 15000,
  validateStatus: () => true,
  proxy: false, // bypass corporate proxy (e.g. Zscaler) for localhost connections
});

/**
 * Returns a set of request helpers pre-loaded with a Bearer token.
 * Each method mirrors the axios API but injects the Authorization header.
 */
export function authed(token: string) {
  const headers = { Authorization: `Bearer ${token}` };

  return {
    get: (url: string, params?: Record<string, unknown>): Promise<AxiosResponse> =>
      api.get(url, { headers, params }),

    post: (url: string, data?: unknown): Promise<AxiosResponse> =>
      api.post(url, data, { headers }),

    put: (url: string, data?: unknown): Promise<AxiosResponse> =>
      api.put(url, data, { headers }),

    patch: (url: string, data?: unknown): Promise<AxiosResponse> =>
      api.patch(url, data, { headers }),

    delete: (url: string, data?: unknown): Promise<AxiosResponse> =>
      api.delete(url, { headers, data }),
  };
}

/** Convenience: assert response is 2xx and return the data payload */
export function expectOk(res: AxiosResponse, expectedStatus = 200) {
  if (res.status !== expectedStatus) {
    throw new Error(
      `Expected HTTP ${expectedStatus} but got ${res.status}. ` +
      `Body: ${JSON.stringify(res.data)}`
    );
  }
  return res.data?.data ?? res.data;
}
