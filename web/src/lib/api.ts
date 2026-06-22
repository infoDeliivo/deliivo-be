// Browser calls go through the Next.js server-side proxy (/api/proxy/*).
// Server-side (proxy route, SSR) calls the backend directly.
// Using a function avoids Next.js build-time inlining of process.env values.
function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    // Always use the proxy from the browser — never call the backend directly
    return '/api/proxy';
  }
  // Server-side: direct to backend container
  return process.env.BACKEND_URL || 'http://backend:3000';
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isIdempotentMethod(method?: string) {
  return !method || ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Token storage (client-side only)
const TOKEN_KEY = 'deliivo_access_token';
const REFRESH_KEY = 'deliivo_refresh_token';

export function getTokens(): TokenPair | null {
  if (typeof window === 'undefined') return null;
  const accessToken = localStorage.getItem(TOKEN_KEY);
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export function setTokens(tokens: TokenPair) {
  localStorage.setItem(TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

// Refresh token logic
let refreshPromise: Promise<TokenPair> | null = null;

async function refreshAccessToken(): Promise<TokenPair> {
  const tokens = getTokens();
  if (!tokens) throw new Error('No refresh token');

  const res = await fetch(`${getApiBaseUrl()}/api/v1/auth/access-token`, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  });

  if (!res.ok) {
    clearTokens();
    throw new Error('Session expired');
  }

  const json = await res.json();
  const newTokens: TokenPair = {
    accessToken: json.data.accessToken,
    refreshToken: json.data.refreshToken,
  };
  setTokens(newTokens);
  return newTokens;
}

async function parseApiResponse(res: Response): Promise<{ json: unknown; rawText: string; isJson: boolean; requestId?: string }> {
  const rawText = await res.text();
  if (!rawText) {
    return {
      json: null,
      rawText,
      isJson: false,
      requestId: res.headers.get('x-request-id') || undefined,
    };
  }

  const contentType = res.headers.get('content-type') || '';
  const expectsJson = contentType.includes('application/json') || contentType.includes('+json');

  try {
    return {
      json: JSON.parse(rawText),
      rawText,
      isJson: true,
      requestId: res.headers.get('x-request-id') || undefined,
    };
  } catch {
    if (expectsJson) {
      throw new ApiError(
        'Invalid JSON response from API',
        res.status,
        rawText.slice(0, 300),
        res.headers.get('x-request-id') || undefined,
      );
    }
    return {
      json: null,
      rawText,
      isJson: false,
      requestId: res.headers.get('x-request-id') || undefined,
    };
  }
}

function getResponseMessage(json: unknown, rawText: string, status: number): string {
  if (json && typeof json === 'object') {
    const body = json as { message?: string; error?: string };
    if (body.message) return body.message;
    if (body.error) return body.error;
  }

  const trimmed = rawText.trim();
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) {
    return `API returned HTML instead of JSON (${status}). Check that the backend is running and the web proxy points to the API.`;
  }

  return trimmed.slice(0, 180) || 'Request failed';
}

// Main API fetch wrapper
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
  retry = true
): Promise<T> {
  const tokens = getTokens();
  const isFormData = options.body instanceof FormData;
  const method = (options.method || 'GET').toUpperCase();
  const requestId = createRequestId();
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string> || {}),
    'x-request-id': requestId,
  };

  if (tokens?.accessToken) {
    headers['Authorization'] = `Bearer ${tokens.accessToken}`;
  }

  const performFetch = async () => fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    headers,
  });

  let res: Response;
  try {
    res = await performFetch();
  } catch (error) {
    if (retry && isIdempotentMethod(method)) {
      await delay(350);
      try {
        res = await performFetch();
      } catch (secondError) {
        throw new ApiError(
          'Unable to reach the server. Check your connection and try again.',
          0,
          secondError instanceof Error ? secondError.message : secondError
        );
      }
    } else {
      throw new ApiError(
        'Unable to reach the server. Check your connection and try again.',
        0,
        error instanceof Error ? error.message : error
      );
    }
  }

  // If 401 and we have a refresh token, try refreshing
  if (res.status === 401 && retry && tokens?.refreshToken) {
    try {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken();
      }
      await refreshPromise;
      refreshPromise = null;
      return apiFetch<T>(path, options, false);
    } catch {
      refreshPromise = null;
      clearTokens();
      if (typeof window !== 'undefined') {
        window.location.href = '/auth/signin';
      }
      throw new Error('Session expired');
    }
  }

  if (retry && isIdempotentMethod(method) && [502, 503, 504].includes(res.status)) {
    await delay(350);
    const retryRes = await performFetch();
    if (retryRes.status !== res.status) {
      res = retryRes;
    } else if (retryRes.ok) {
      res = retryRes;
    }
  }

  const { json, rawText, isJson, requestId: responseRequestId } = await parseApiResponse(res);

  if (!res.ok) {
    throw new ApiError(
      getResponseMessage(json, rawText, res.status),
      res.status,
      json ?? rawText,
      responseRequestId || requestId,
    );
  }

  if (!isJson) {
    throw new ApiError(
      getResponseMessage(json, rawText, res.status),
      res.status,
      rawText,
      responseRequestId || requestId,
    );
  }

  return json as T;
}

export class ApiError extends Error {
  status: number;
  data: unknown;
  requestId?: string;

  constructor(message: string, status: number, data: unknown, requestId?: string) {
    super(message);
    this.status = status;
    this.data = data;
    this.requestId = requestId;
  }
}

export function getApiErrorMessage(error: unknown, fallback = 'Request failed') {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

// Auth API
export const authApi = {
  signup(method: 'email' | 'phone', identifier: string) {
    const body = method === 'email'
      ? { method, email: identifier }
      : { method, phone: identifier };
    return apiFetch<{ message: string; data: { next: string; code?: string } }>(
      '/api/v1/auth/signup',
      { method: 'POST', body: JSON.stringify(body) }
    );
  },

  login(method: 'email' | 'phone', identifier: string) {
    return apiFetch<{ message: string; data: { next: string; code?: string } }>(
      '/api/v1/auth/login',
      { method: 'POST', body: JSON.stringify({ method, identifier }) }
    );
  },

  verifyOtp(identifier: string, code: string, purpose: 'signup' | 'login', method: 'email' | 'phone') {
    return apiFetch<{
      message: string;
      data: {
        accessToken: string;
        refreshToken: string;
        user: { id: string; email?: string; role: string };
        next: 'onboarding' | 'home';
      };
    }>(
      '/api/v1/auth/otp/verify',
      { method: 'POST', body: JSON.stringify({ identifier, code, purpose, method }) }
    );
  },

  resendOtp(identifier: string, purpose: string, method: 'email' | 'phone') {
    return apiFetch<{ message: string; data: { code?: string } }>(
      '/api/v1/auth/otp/resend',
      { method: 'POST', body: JSON.stringify({ identifier, purpose, method }) }
    );
  },

  logout() {
    const tokens = getTokens();
    if (!tokens) return Promise.resolve();
    return apiFetch('/api/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    }).finally(() => clearTokens());
  },

  acceptTos(tosVersion: string, privacyVersion: string) {
    return apiFetch('/api/v1/auth/accept-tos', {
      method: 'POST',
      body: JSON.stringify({ tosVersion, privacyVersion }),
    });
  },
};

// User API
export const userApi = {
  getMe() {
    return apiFetch<{ data: UserProfile }>('/api/v1/users/me');
  },

  getMyProfile() {
    return apiFetch<{ data: UserFullProfile }>('/api/v1/users/me/profile');
  },

  getPublicProfile(userId: string) {
    return apiFetch<{ data: UserFullProfile }>(`/api/v1/users/${userId}/profile`);
  },

  updateProfile(data: Partial<UserProfileUpdate>) {
    return apiFetch('/api/v1/users/me/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  completeOnboarding(data: OnboardingData) {
    return apiFetch('/api/v1/users/me/onboarding/complete', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  uploadAvatar(file: File) {
    const formData = new FormData();
    formData.append('image', file);
    return apiFetch<{ data: { avatarUrl: string } }>('/api/v1/users/me/avatar', {
      method: 'POST',
      headers: {},
      body: formData,
    });
  },
};

// Ratings API
export const ratingsApi = {
  submitRating(bookingId: string, stars: number, reviewText?: string) {
    return apiFetch<{ data: Rating }>(`/api/v1/ratings/bookings/${bookingId}`, {
      method: 'POST',
      body: JSON.stringify({ stars, ...(reviewText ? { reviewText } : {}) }),
    });
  },
};

export interface Rating {
  id: string;
  bookingId: string;
  rideId: string;
  raterId: string;
  rateeId: string;
  stars: number;
  reviewText: string | null;
  createdAt: string;
}

// Vehicle API
export const vehicleApi = {
  list(page = 1, limit = 10) {
    return apiFetch<{ data: { vehicles: Vehicle[]; pagination: Pagination } }>(`/api/v1/vehicles?page=${page}&limit=${limit}`);
  },

  get(id: string) {
    return apiFetch<{ data: Vehicle }>(`/api/v1/vehicles/${id}`);
  },

  createDraft(licenseCountry: string, licenseNumber: string) {
    return apiFetch<{ data: VehicleDraft }>('/api/v1/vehicles/draft', {
      method: 'POST',
      body: JSON.stringify({ licenseCountry, licenseNumber }),
    });
  },

  updateDraftDetails(details: VehicleDetails) {
    return apiFetch<{ data: VehicleDraft }>('/api/v1/vehicles/draft/vehicle-details', {
      method: 'PUT',
      body: JSON.stringify(details),
    });
  },

  saveDraft() {
    return apiFetch<{ data: Vehicle }>('/api/v1/vehicles/draft/save', { method: 'POST' });
  },

  updateDetails(id: string, details: VehicleDetails) {
    return apiFetch(`/api/v1/vehicles/${id}/update-details`, {
      method: 'PUT',
      body: JSON.stringify(details),
    });
  },

  uploadImage(id: string, file: File) {
    const formData = new FormData();
    formData.append('image', file);
    return apiFetch<{ data: { imageUrl: string } }>(`/api/v1/vehicles/${id}/image`, {
      method: 'POST',
      headers: {},
      body: formData,
    });
  },

  uploadDraftDocument(file: File, documentType: string) {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('documentType', documentType);
    return apiFetch<{ data: { imageUrl: string; documentType: string } }>('/api/v1/vehicles/draft/upload-document', {
      method: 'POST',
      headers: {},
      body: formData,
    });
  },

  delete(id: string) {
    return apiFetch(`/api/v1/vehicles/${id}`, { method: 'DELETE' });
  },
};

// Travel Preferences API
export const travelPreferencesApi = {
  get() {
    return apiFetch<{ data: TravelPreference }>('/api/v1/travel-preferences');
  },

  save(data: TravelPreferenceUpdate) {
    return apiFetch<{ data: TravelPreference }>('/api/v1/travel-preferences', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  update(data: TravelPreferenceUpdate) {
    return apiFetch<{ data: TravelPreference }>('/api/v1/travel-preferences', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
};

// Maps API
export const mapsApi = {
  autocomplete(input: string, lat?: number, lng?: number) {
    const params = new URLSearchParams({ input });
    if (lat !== undefined && lng !== undefined) {
      params.set('lat', String(lat));
      params.set('lng', String(lng));
    }
    return apiFetch<{ data: PlacePrediction[] }>(`/api/v1/maps/place/autocomplete?${params}`);
  },

  placeDetails(placeId: string) {
    return apiFetch<{ data: { name: string; address: string; location: { lat: number; lng: number } } }>(
      `/api/v1/maps/place/place-details?placeId=${encodeURIComponent(placeId)}`
    );
  },
};

// Publish Ride API (Draft wizard flow)
export const publishRideApi = {
  // Step 1: Create draft with origin
  createWithOrigin(data: {
    originPlaceId: string;
    originAddress: string;
    originLat: number;
    originLng: number;
  }) {
    return apiFetch<{ data: DraftRide }>('/api/v1/publish-ride/draft/origin', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Step 2: Set destination
  updateDestination(data: {
    destinationPlaceId: string;
    destinationAddress: string;
    destinationLat: number;
    destinationLng: number;
  }) {
    return apiFetch<{ data: DraftRide }>('/api/v1/publish-ride/draft/destination', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Step 3: Compute routes
  computeRoutes() {
    return apiFetch<{ data: { routes: RouteOption[]; selectedIndex: number | null } }>(
      '/api/v1/publish-ride/draft/routes/compute'
    );
  },

  // Step 4: Select route
  selectRoute(routeIndex: number) {
    return apiFetch<{ data: DraftRide }>('/api/v1/publish-ride/draft/routes/select', {
      method: 'PUT',
      body: JSON.stringify({ routeIndex }),
    });
  },

  // Step 5: Get stopover suggestions
  getStopoverSuggestions() {
    return apiFetch<{ data: { suggestions: StopoverSuggestion[]; routeDistanceKm: number; basePricePerSeat: number | null } }>(
      '/api/v1/publish-ride/draft/stopovers/suggestions'
    );
  },

  // Step 6: Set stopovers
  updateStopovers(stopovers: LocationInput[]) {
    return apiFetch<{ data: DraftRide }>('/api/v1/publish-ride/draft/stopovers', {
      method: 'PUT',
      body: JSON.stringify({ stopovers }),
    });
  },

  // Step 7: Set schedule
  updateSchedule(departureDate: string, departureTime: string) {
    return apiFetch<{ data: DraftRide }>('/api/v1/publish-ride/draft/schedule', {
      method: 'PUT',
      body: JSON.stringify({ departureDate, departureTime }),
    });
  },

  // Step 8: Set capacity
  updateCapacity(
    totalSeats: number,
    maxLuggagePerPerson: number,
    backSeatOnly: boolean,
    preferences?: { noSmoking?: boolean; noBicycles?: boolean; childSeatAvailable?: boolean }
  ) {
    return apiFetch<{ data: DraftRide }>('/api/v1/publish-ride/draft/capacity', {
      method: 'PUT',
      body: JSON.stringify({ totalSeats, maxLuggagePerPerson, backSeatOnly, ...preferences }),
    });
  },

  // Step 9: Get recommended price
  getRecommendedPrice() {
    return apiFetch<{ data: PriceRecommendation }>('/api/v1/publish-ride/draft/pricing/recommended');
  },

  // Step 10: Set pricing
  updatePricing(basePricePerSeat: number, stopoverPricing?: { placeId: string; pricePerSeat: number }[]) {
    return apiFetch<{ data: DraftRide }>('/api/v1/publish-ride/draft/pricing', {
      method: 'PUT',
      body: JSON.stringify({ basePricePerSeat, stopoverPricing }),
    });
  },

  // Step 11: Update notes
  updateNotes(notes: string, femaleOnly?: boolean) {
    return apiFetch<{ data: DraftRide }>('/api/v1/publish-ride/draft/notes', {
      method: 'PATCH',
      body: JSON.stringify({ notes, femaleOnly }),
    });
  },

  // Step 12: Publish
  publish() {
    return apiFetch<{ data: PublishedRide }>('/api/v1/publish-ride/draft/publish', {
      method: 'POST',
    });
  },

  getRideById(rideId: string) {
    return apiFetch<{ data: DriverPublishedRide }>(`/api/v1/publish-ride/${rideId}`);
  },

  // Get current draft
  getDraft() {
    return apiFetch<{ data: DraftRide | null }>('/api/v1/publish-ride/draft');
  },

  // Get user's published rides
  getUserRides(status?: string | string[], page = 1, limit = 10) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (Array.isArray(status) && status.length > 0) params.set('status', status.join(','));
    else if (typeof status === 'string' && status) params.set('status', status);
    return apiFetch<{ data: { rides: PublishedRide[]; pagination: Pagination } }>(`/api/v1/publish-ride?${params}`);
  },

  cancelRide(rideId: string) {
    return apiFetch(`/api/v1/publish-ride/${rideId}`, {
      method: 'DELETE',
    });
  },

  // Get fuel price
  getFuelPrice(currency = 'EUR') {
    return apiFetch<{ data: { pricePerLiter: number; currency: string } }>(
      `/api/v1/publish-ride/fuel-price?currency=${currency}`
    );
  },
};

// Search Rides API
export const searchRidesApi = {
  createAlert(data: { originLat: number; originLng: number; destinationLat: number; destinationLng: number; departureDate: string; originAddress?: string; destinationAddress?: string }) {
    return apiFetch<{ data: { id: string } }>('/api/v1/search-rides/notify', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  search(params: SearchRidesParams) {
    const query = new URLSearchParams();
    query.set('originLat', String(params.originLat));
    query.set('originLng', String(params.originLng));
    query.set('destinationLat', String(params.destinationLat));
    query.set('destinationLng', String(params.destinationLng));
    query.set('departureDate', params.departureDate);
    if (params.seatsRequired) query.set('seatsRequired', String(params.seatsRequired));
    if (params.femaleOnly) query.set('femaleOnly', 'true');
    if (params.maxPrice) query.set('maxPrice', String(params.maxPrice));
    if (params.sortBy) query.set('sortBy', params.sortBy);
    if (params.sortOrder) query.set('sortOrder', params.sortOrder);
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));
    if (params.radiusKm) query.set('radiusKm', String(params.radiusKm));
    return apiFetch<{ data: SearchRidesResponse }>(`/api/v1/search-rides/advanced?${query}`);
  },

  getDetails(id: string, segmentId?: string) {
    const query = segmentId ? `?segmentId=${segmentId}` : '';
    return apiFetch<{ data: RideDetails }>(`/api/v1/search-rides/${id}${query}`);
  },

  getRecent(limit = 5) {
    return apiFetch<{ data: RecentSearch[] }>(`/api/v1/search-rides/user/recent?limit=${limit}`);
  },
};

// Bookings API
export const bookingsApi = {
  pricePreview(data: { rideId: string; seatsBooked: number; segmentId?: string; pickupWaypointId?: string; dropoffWaypointId?: string }) {
    return apiFetch<{ data: PricePreview }>('/api/v1/bookings/price-preview', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  create(data: CreateBookingInput) {
    return apiFetch<{ data: Booking }>('/api/v1/bookings', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  list(status?: string | string[], page = 1, limit = 10) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (Array.isArray(status) && status.length > 0) params.set('status', status.join(','));
    else if (typeof status === 'string' && status) params.set('status', status);
    return apiFetch<{ data: { bookings: Booking[]; pagination: Pagination } }>(`/api/v1/bookings?${params}`);
  },

  getById(id: string) {
    return apiFetch<{ data: Booking }>(`/api/v1/bookings/${id}`);
  },

  withdraw(id: string, reason?: string) {
    return apiFetch<{ data: Booking }>(`/api/v1/bookings/${id}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  cancel(id: string, reason?: string) {
    return apiFetch<{ data: Booking }>(`/api/v1/bookings/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  confirmPayment(id: string) {
    return apiFetch<{ data: Booking }>(`/api/v1/bookings/${id}/payment/confirm`, {
      method: 'POST',
    });
  },
};

// Driver Booking API (accept/reject/OTP)
export const driverBookingApi = {
  accept(bookingId: string) {
    return apiFetch<{ data: DriverBookingResult }>(`/api/v1/driver/bookings/${bookingId}/accept`, { method: 'POST' });
  },
  reject(bookingId: string, reason?: string) {
    const body = reason ? JSON.stringify({ reason }) : undefined;
    return apiFetch<{ data: DriverBookingResult }>(`/api/v1/driver/bookings/${bookingId}/reject`, {
      method: 'POST',
      ...(body ? { body } : {}),
    });
  },
  verifyPickupOtp(bookingId: string, otp: string) {
    return apiFetch<{ data: DriverBookingResult }>(`/api/v1/driver/bookings/${bookingId}/pickup-otp/verify`, {
      method: 'POST', body: JSON.stringify({ otp }),
    });
  },
  verifyDropOtp(bookingId: string, otp: string) {
    return apiFetch<{ data: DriverBookingResult }>(`/api/v1/driver/bookings/${bookingId}/drop-otp/verify`, {
      method: 'POST', body: JSON.stringify({ otp }),
    });
  },
};

// Ride Operations API (start/finish/location)
function createEventMeta(overrides?: { overrideReason?: string }) {
  return {
    actionId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    clientTimestamp: new Date().toISOString(),
    ...(overrides?.overrideReason ? { overrideReason: overrides.overrideReason } : {}),
  };
}

function createEventMetaWithLocation(lat?: number, lng?: number, overrides?: { overrideReason?: string }) {
  return {
    ...createEventMeta(overrides),
    ...(lat != null && lng != null ? { lat, lng } : {}),
  };
}

export const rideOpsApi = {
  startRide(rideId: string, overrideReason?: string) {
    return apiFetch<{ message: string }>(`/api/v1/rides/${rideId}/start`, {
      method: 'POST', body: JSON.stringify(createEventMeta({ overrideReason })),
    });
  },
  finishRide(rideId: string, overrideReason?: string) {
    return apiFetch<{ message: string }>(`/api/v1/rides/${rideId}/finish`, {
      method: 'POST', body: JSON.stringify(createEventMeta({ overrideReason })),
    });
  },
  submitLocation(rideId: string, lat: number, lng: number) {
    return apiFetch(`/api/v1/rides/${rideId}/locations`, {
      method: 'POST', body: JSON.stringify({ lat, lng, timestamp: new Date().toISOString() }),
    });
  },
  getLatestLocation(rideId: string) {
    return apiFetch<{ data: LocationUpdateRecord | null }>(`/api/v1/rides/${rideId}/latest-location`);
  },
  driverArrived(bookingId: string, lat?: number, lng?: number, overrideReason?: string) {
    return apiFetch(`/api/v1/bookings/${bookingId}/driver-arrived`, {
      method: 'POST', body: JSON.stringify(createEventMetaWithLocation(lat, lng, { overrideReason })),
    });
  },
  markNoShow(bookingId: string, lat?: number, lng?: number, overrideReason?: string) {
    return apiFetch(`/api/v1/bookings/${bookingId}/mark-no-show`, {
      method: 'POST', body: JSON.stringify(createEventMetaWithLocation(lat, lng, { overrideReason })),
    });
  },
  verifyPickupOtp(bookingId: string, otp: string, overrideReason?: string) {
    return apiFetch(`/api/v1/bookings/${bookingId}/verify-pickup-otp`, {
      method: 'POST', body: JSON.stringify({ otp, ...createEventMeta({ overrideReason }) }),
    });
  },
  riderArrivedAtPickup(bookingId: string, lat?: number, lng?: number, overrideReason?: string) {
    return apiFetch(`/api/v1/bookings/${bookingId}/rider-arrived`, {
      method: 'POST', body: JSON.stringify(createEventMetaWithLocation(lat, lng, { overrideReason })),
    });
  },
  reportMissedPickup(bookingId: string, lat?: number, lng?: number, overrideReason?: string) {
    return apiFetch(`/api/v1/bookings/${bookingId}/report-missed-pickup`, {
      method: 'POST', body: JSON.stringify(createEventMetaWithLocation(lat, lng, { overrideReason })),
    });
  },
  confirmDropoff(bookingId: string, lat?: number, lng?: number, overrideReason?: string) {
    return apiFetch(`/api/v1/bookings/${bookingId}/confirm-dropoff`, {
      method: 'POST', body: JSON.stringify(createEventMetaWithLocation(lat, lng, { overrideReason })),
    });
  },
  riderConfirmDropoff(bookingId: string, overrideReason?: string) {
    return apiFetch(`/api/v1/bookings/${bookingId}/rider-confirm-dropoff`, {
      method: 'POST', body: JSON.stringify(createEventMeta({ overrideReason })),
    });
  },
  devSimulatePickup(bookingId: string, lat?: number, lng?: number, overrideReason?: string) {
    return apiFetch(`/api/v1/bookings/${bookingId}/dev-simulate-pickup`, {
      method: 'POST', body: JSON.stringify(createEventMetaWithLocation(lat, lng, { overrideReason })),
    });
  },
  devSimulateDropoff(bookingId: string, lat?: number, lng?: number, overrideReason?: string) {
    return apiFetch(`/api/v1/bookings/${bookingId}/dev-simulate-dropoff`, {
      method: 'POST', body: JSON.stringify(createEventMetaWithLocation(lat, lng, { overrideReason })),
    });
  },
};

export const trackingApi = {
  createLink(bookingId: string, ttlHours = 24, accessScope = 'LOCATION_ONLY') {
    return apiFetch<{ data: TrackingLink }>(`/api/v1/tracking/links`, {
      method: 'POST',
      body: JSON.stringify({ bookingId, ttlHours, accessScope }),
    });
  },
  listLinks(bookingId: string) {
    return apiFetch<{ data: TrackingLink[] }>(`/api/v1/tracking/bookings/${bookingId}/links`);
  },
  revokeLink(linkId: string) {
    return apiFetch(`/api/v1/tracking/links/${linkId}`, { method: 'DELETE' });
  },
  getPublic(token: string) {
    return apiFetch<{ data: PublicTrackingData }>(`/api/v1/tracking/${token}`);
  },
};

// Chat API
export const chatApi = {
  getConversations(cursor?: string, limit = 20) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return apiFetch<{ data: { conversations: ConversationItem[]; nextCursor: string | null } }>(`/api/v1/chat?${params}`);
  },
  getMessages(conversationId: string, cursor?: string, limit = 30) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return apiFetch<{ data: { messages: ChatMessage[]; nextCursor: string | null } }>(`/api/v1/chat/${conversationId}/messages?${params}`);
  },
  sendMessage(receiverId: string, text: string, clientMsgId: string) {
    return apiFetch<{ data: ChatMessage }>('/api/v1/chat/send', {
      method: 'POST', body: JSON.stringify({ receiverId, text, clientMsgId, type: 'TEXT' }),
    });
  },
  getUnreadCount() {
    return apiFetch<{ data: { count: number } }>('/api/v1/chat/unread-count');
  },
  markRead(conversationId: string, lastReadMessageId: string) {
    return apiFetch(`/api/v1/chat/${conversationId}/read`, {
      method: 'POST', body: JSON.stringify({ lastReadMessageId }),
    });
  },
};

// Notifications API
export const notificationsApi = {
  list(cursor?: string, limit = 20) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return apiFetch<{ data: { notifications: NotificationRecord[]; nextCursor: string | null; hasMore: boolean } }>(`/api/v1/notifications?${params}`);
  },
  getUnreadCount() {
    return apiFetch<{ data: { unreadCount: number } }>('/api/v1/notifications/unread-count');
  },
  markRead(notificationIds: string[]) {
    return apiFetch<{ data: { markedCount: number } }>('/api/v1/notifications/mark-read', {
      method: 'POST',
      body: JSON.stringify({ notificationIds }),
    });
  },
  markOneRead(notificationId: string) {
    return apiFetch<{ data: { markedCount: number } }>('/api/v1/notifications/mark-read', {
      method: 'POST',
      body: JSON.stringify({ notificationIds: [notificationId] }),
    });
  },
  registerDevice(platform: 'ios' | 'android' | 'web', token: string) {
    return apiFetch<{ data: { id: string; platform: string; token: string; userId: string } }>('/api/v1/notifications/device-token', {
      method: 'POST',
      body: JSON.stringify({ platform, token }),
    });
  },
};

// Safety / Emergency API
export type EmergencySosRole = 'RIDER' | 'DRIVER';

export interface EmergencyAlert {
  id: string;
  userId: string;
  rideId: string | null;
  bookingId: string | null;
  role: EmergencySosRole;
  status: string;
  message: string | null;
  lat: number | null;
  lng: number | null;
  createdAt: string;
}

export const safetyApi = {
  createSos(data: {
    rideId?: string;
    bookingId?: string;
    role?: EmergencySosRole;
    message?: string;
    lat?: number;
    lng?: number;
  }) {
    return apiFetch<{ data: EmergencyAlert }>('/api/v1/safety/sos', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// Live operations types
export interface DriverBookingResult {
  bookingId: string;
  rideId: string;
  passengerId: string;
  status: string;
}

export interface ConversationItem {
  id: string;
  peer: { id: string; name: string | null; avatarUrl: string | null };
  lastMessage: { id: string; text: string | null; senderId: string; createdAt: string; type: string } | null;
  unreadCount: number;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  receiverId: string;
  type: string;
  text: string | null;
  clientMsgId: string | null;
  createdAt: string;
}

// Payments / Stripe Connect API
export const paymentsApi = {
  connectOnboard() {
    return apiFetch<{ data: { url: string } }>('/api/v1/payments/connect/onboard', { method: 'POST' });
  },
  connectStatus() {
    return apiFetch<{ data: ConnectStatus }>('/api/v1/payments/connect/status');
  },
  transactions() {
    return apiFetch<{ data: RiderTransaction[] }>('/api/v1/payments/transactions');
  },
};

// Driver Payouts API
export const payoutsApi = {
  getEarnings() {
    return apiFetch<{ success: boolean; data: DriverEarnings }>('/api/v1/drivers/me/earnings');
  },
  getEarningItems() {
    return apiFetch<{ success: boolean; data: DriverEarningItem[] }>('/api/v1/drivers/me/earnings/items');
  },
  getBalance() {
    return apiFetch<{ success: boolean; data: DriverBalance }>('/api/v1/drivers/me/balance');
  },
  getHistory() {
    return apiFetch<{ success: boolean; data: PayoutRecord[] }>('/api/v1/drivers/me/payouts');
  },
  requestPayout() {
    return apiFetch<{ data: { status: string; amount?: number } }>('/api/v1/drivers/me/payouts/request', {
      method: 'POST',
    });
  },
};

// Payment Methods API
export const paymentMethodsApi = {
  list() {
    return apiFetch<{ data: PaymentMethod[] }>('/api/v1/payment-methods');
  },
  createSetupIntent() {
    return apiFetch<{ data: { clientSecret: string; customerId: string; setupIntentId: string } }>('/api/v1/payment-methods/setup-intent', { method: 'POST' });
  },
  save(stripePaymentMethodId: string, stripeCustomerId: string) {
    return apiFetch<{ data: PaymentMethod }>('/api/v1/payment-methods/save', {
      method: 'POST',
      body: JSON.stringify({ stripePaymentMethodId, stripeCustomerId }),
    });
  },
  setDefault(paymentMethodId: string) {
    return apiFetch(`/api/v1/payment-methods/${paymentMethodId}/default`, {
      method: 'POST',
    });
  },
  remove(paymentMethodId: string) {
    return apiFetch(`/api/v1/payment-methods/${paymentMethodId}`, { method: 'DELETE' });
  },
};

// Disputes API
export const disputesApi = {
  create(data: { rideId: string; bookingId: string; reason: string; description?: string }) {
    return apiFetch<{ data: Dispute }>('/api/v1/disputes', {
      method: 'POST', body: JSON.stringify(data),
    });
  },
  getMyDisputes() {
    return apiFetch<{ data: Dispute[] }>('/api/v1/disputes/me');
  },
  getById(id: string) {
    return apiFetch<{ data: Dispute }>(`/api/v1/disputes/${id}`);
  },
};

// Admin API
export const adminApi = {
  getStats() {
    return apiFetch<{ data: AdminStats }>('/api/v1/admin/stats');
  },
  getMonitoringTrends() {
    return apiFetch<{ data: AdminMonitoringTrend[] }>('/api/v1/admin/stats/trends');
  },
  getOperationsSummary() {
    return apiFetch<{ data: AdminOperationsSummary }>('/api/v1/admin/ops/summary');
  },
  getReadinessHealth() {
    return apiFetch<{ data: HealthReadyStatus }>('/health/ready');
  },
  getPricingConfigs() {
    return apiFetch<{ data: AdminPricingConfig[] }>('/api/v1/admin/pricing/configs');
  },
  createPricingConfig(data: AdminPricingConfigWriteInput) {
    return apiFetch<{ data: AdminPricingConfig }>('/api/v1/admin/pricing/configs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  updatePricingConfig(id: string, data: Partial<AdminPricingConfigWriteInput>) {
    return apiFetch<{ data: AdminPricingConfig }>(`/api/v1/admin/pricing/configs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  getUsers(params?: { page?: number; limit?: number; search?: string; isBanned?: string; role?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.search) query.set('search', params.search);
    if (params?.isBanned) query.set('isBanned', params.isBanned);
    if (params?.role) query.set('role', params.role);
    return apiFetch<{ data: { users: AdminUser[]; pagination: Pagination } }>(`/api/v1/admin/users?${query}`);
  },
  getRides(params?: { page?: number; limit?: number; status?: string; search?: string; searchBy?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.status) query.set('status', params.status);
    if (params?.search) query.set('search', params.search);
    if (params?.searchBy) query.set('searchBy', params.searchBy);
    return apiFetch<{ data: { rides: AdminRide[]; pagination: Pagination } }>(`/api/v1/admin/rides?${query}`);
  },
  banUser(id: string) {
    return apiFetch<{ data: { id: string; isBanned: boolean } }>(`/api/v1/admin/users/${id}/ban`, { method: 'POST' });
  },
  unbanUser(id: string) {
    return apiFetch<{ data: { id: string; isBanned: boolean } }>(`/api/v1/admin/users/${id}/unban`, { method: 'POST' });
  },
  verifyVehicle(id: string) {
    return apiFetch<{ data: { id: string; isVerified: boolean } }>(`/api/v1/admin/vehicles/${id}/verify`, { method: 'POST' });
  },
  refundBooking(id: string) {
    return apiFetch<{ data: { bookingId: string; refunded: boolean } }>(`/api/v1/admin/bookings/${id}/refund`, { method: 'POST' });
  },
  // Disputes
  getDisputes(params?: { status?: string; page?: number; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    return apiFetch<{ data: { disputes: AdminDispute[]; pagination: Pagination } }>(`/api/v1/admin/disputes?${query}`);
  },
  getDisputeById(id: string) {
    return apiFetch<{ data: AdminDispute }>(`/api/v1/admin/disputes/${id}`);
  },
  resolveDispute(id: string, resolution: string, refundPercent?: number) {
    return apiFetch<{ data: AdminDispute }>(`/api/v1/admin/disputes/${id}/resolve`, {
      method: 'POST', body: JSON.stringify({ resolution, ...(refundPercent != null ? { refundPercent } : {}) }),
    });
  },
  collectEvidence(id: string) {
    return apiFetch<{ data: unknown }>(`/api/v1/admin/disputes/${id}/collect-evidence`, { method: 'POST' });
  },
  evaluateDispute(id: string) {
    return apiFetch<{ data: { disputeId: string; recommendation: string; riskScore: number; status: string } }>(`/api/v1/admin/disputes/${id}/evaluate`, { method: 'POST' });
  },
  // Payouts
  processPayout(driverId: string) {
    return apiFetch<{ data: { driverId: string; status: string; amount?: number; batchId?: string } }>('/api/v1/admin/payouts/process', {
      method: 'POST', body: JSON.stringify({ driverId }),
    });
  },
  checkPayoutEligibility() {
    return apiFetch<{ data: { checked: number; markedEligible: number } }>('/api/v1/admin/payouts/check-eligibility', { method: 'POST' });
  },
  getEligiblePayouts() {
    return apiFetch<{ data: AdminPayoutCandidate[] }>('/api/v1/admin/payouts/eligible');
  },
  // Reconciliation
  getReconciliationSummary() {
    return apiFetch<{ data: ReconciliationSummary }>('/api/v1/admin/reconciliation/summary');
  },
  getRevenueLedger(params?: { page?: number; limit?: number; accountType?: string }) {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.accountType) query.set('accountType', params.accountType);
    return apiFetch<{ data: AdminRevenueLedger }>(`/api/v1/admin/revenue/ledger?${query}`);
  },
  getEmergencyAlerts(params?: { status?: string; page?: number; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    return apiFetch<{ data: { alerts: AdminEmergencyAlert[]; openCount: number; pagination: Pagination } }>(`/api/v1/admin/sos?${query}`);
  },
  updateEmergencyAlertStatus(id: string, status: 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_ALARM') {
    return apiFetch<{ data: AdminEmergencyAlert }>(`/api/v1/admin/sos/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  },
  getReconciliationIssues(params?: { status?: string; issueType?: string; severity?: string; page?: number; limit?: number }) {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.issueType) query.set('issueType', params.issueType);
    if (params?.severity) query.set('severity', params.severity);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    return apiFetch<{ data: { issues: ReconciliationIssue[]; pagination: Pagination } }>(`/api/v1/admin/reconciliation/issues?${query}`);
  },
  resolveReconciliationIssue(id: string, resolution: string) {
    return apiFetch<{ data: ReconciliationIssue }>(`/api/v1/admin/reconciliation/issues/${id}/resolve`, {
      method: 'POST', body: JSON.stringify({ resolution }),
    });
  },
  runHourlyReconciliation() {
    return apiFetch<{ data: { checked: number; issues: number; repaired: number } }>('/api/v1/admin/reconciliation/run/hourly', { method: 'POST' });
  },
  runDailyReconciliation() {
    return apiFetch<{ data: { staleEscrow: number; ledgerIssues: number } }>('/api/v1/admin/reconciliation/run/daily', { method: 'POST' });
  },
};

export const contentApi = {
  listPublished(locale?: string) {
    const query = new URLSearchParams();
    if (locale) query.set('locale', locale);
    const suffix = query.toString() ? `?${query}` : '';
    return apiFetch<{ data: ContentPost[] }>(`/api/v1/content/posts${suffix}`);
  },
  listAdminPosts() {
    return apiFetch<{ data: ContentPost[] }>('/api/v1/admin/content/posts');
  },
  listAdminAudit(postId?: string, limit = 20) {
    const query = new URLSearchParams();
    if (postId) query.set('postId', postId);
    if (limit) query.set('limit', String(limit));
    const suffix = query.toString() ? `?${query}` : '';
    return apiFetch<{ data: ContentAuditLog[] }>(`/api/v1/admin/content/audit${suffix}`);
  },
  saveAdminPost(input: Partial<ContentPost> & Pick<ContentPost, 'title' | 'excerpt' | 'body' | 'category' | 'readTime' | 'locale'>) {
    return apiFetch<{ data: ContentPost }>('/api/v1/admin/content/posts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  deleteAdminPost(id: string) {
    return apiFetch<{ data: { id: string; deleted: boolean } }>(`/api/v1/admin/content/posts/${id}`, {
      method: 'DELETE',
    });
  },
};

// Admin types
export interface AdminStats {
  totalUsers: number;
  totalRides: number;
  totalBookings: number;
  totalRevenue: number;
}

export interface AdminMonitoringTrend {
  date: string;
  ridesPublished: number;
  bookingsCreated: number;
  webhookEvents: number;
  revenue: number;
}

export interface AdminOperationsSummary {
  uptimeSeconds: number;
  checks: {
    database: boolean;
    redis: boolean;
  };
  configuration: {
    stripeSecretConfigured: boolean;
    stripeWebhookConfigured: boolean;
    firebaseConfigured: boolean;
  };
  operations: {
    openReconciliationIssues: number;
    payoutEligiblePayments: number;
    pendingPaymentRecords: number;
    webhookEvents24h: number;
  };
  content: {
    total: number;
    published: number;
    drafts: number;
    locales: string[];
    updatedAt: string | null;
  };
}

export interface AdminPricingConfig {
  id: string;
  regionCode: string;
  currency: string;
  minRatePerKm: number;
  recommendedRatePerKm: number;
  maxRatePerKm: number;
  minimumSeatPrice: number;
  roundingStrategy: string;
  active: boolean;
  validFrom: string;
  validTo?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPricingConfigWriteInput {
  regionCode: string;
  currency: string;
  minRatePerKm: number;
  recommendedRatePerKm: number;
  maxRatePerKm: number;
  minimumSeatPrice: number;
  roundingStrategy: string;
  active: boolean;
  validFrom?: string;
  validTo?: string | null;
}

export interface HealthReadyStatus {
  status: 'ready' | 'not_ready';
  checks: {
    database: boolean;
    redis: boolean;
    authSecrets: boolean;
    stripe: boolean;
    firebase: boolean;
  };
  uptime: number;
}

export interface HealthReadyStatus {
  status: 'ready' | 'not_ready';
  checks: {
    database: boolean;
    redis: boolean;
    authSecrets: boolean;
    stripe: boolean;
    firebase: boolean;
  };
  uptime: number;
}

export interface AdminUser {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string;
  isBanned: boolean;
  isVerified: boolean;
  dlVerified: boolean;
  onboardingStatus: string;
  createdAt: string;
}

export interface AdminDispute {
  id: string;
  rideId: string;
  bookingId: string;
  raisedBy: string;
  reason: string;
  description?: string;
  status: string;
  evidenceJson?: unknown;
  recommendation?: string;
  riskScore?: number;
  resolution?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  booking?: { id: string; passengerId: string; totalPrice: number; status: string; payment?: { id: string; status: string; amountTotal: number; fareAmount: number; currency: string } | null };
  ride?: { id: string; driverId: string; originAddress: string; destinationAddress: string; departureDate?: string; departureTime?: string };
}

export interface AdminEmergencyAlert {
  id: string;
  userId: string;
  rideId: string | null;
  bookingId: string | null;
  role: 'RIDER' | 'DRIVER';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_ALARM' | string;
  message: string | null;
  lat: number | null;
  lng: number | null;
  createdAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  user?: { id: string; name: string | null; email: string | null; phone: string | null; avatarUrl: string | null };
  ride?: { id: string; originAddress: string; destinationAddress: string; departureDate: string; departureTime: string; status: string } | null;
  booking?: { id: string; passengerId: string; status: string; seatsBooked: number; totalPrice: number } | null;
}

export interface AdminRide {
  id: string;
  status: string;
  originAddress: string;
  destinationAddress: string;
  departureDate: string;
  departureTime: string;
  totalSeats: number;
  availableSeats: number;
  basePricePerSeat: number;
  currency: string;
  createdAt: string;
  driver?: { id: string; name: string | null; email?: string | null; phone?: string | null };
  bookings: Array<{
    id: string;
    status: string;
    passengerId: string;
    seatsBooked: number;
    totalPrice: number;
    paymentAmount?: number | null;
    refundedAt?: string | null;
    passenger?: { id: string; name: string | null; email?: string | null; phone?: string | null };
  }>;
  disputes: Array<{ id: string; status: string; reason: string }>;
}

export interface AdminLedgerEntry {
  id: string;
  entryGroupId: string;
  paymentId?: string | null;
  bookingId?: string | null;
  userId?: string | null;
  accountType: string;
  entryType: string;
  direction: string;
  amount: number;
  currency: string;
  metadataJson?: unknown;
  createdAt: string;
}

export interface AdminRevenueLedger {
  summary: {
    platformCredits: number;
    platformDebits: number;
    netPlatformRevenue: number;
    riderCredits: number;
    driverCredits: number;
  };
  entries: AdminLedgerEntry[];
  pagination: Pagination;
}

export interface ReconciliationSummary {
  open: number;
  autoRepaired: number;
  total: number;
  bySeverity: { LOW: number; MEDIUM: number; HIGH: number; CRITICAL: number };
}

export interface ReconciliationIssue {
  id: string;
  issueType: string;
  severity: string;
  paymentId?: string;
  bookingId?: string;
  description?: string;
  detectedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  resolution?: string;
}

// Payment types
export interface ConnectStatus {
  connected: boolean;
  onboardingComplete: boolean;
  accountId?: string;
  detailsSubmitted?: boolean;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
}

export interface DriverEarnings {
  driverId: string;
  totalEarned: number;
  totalPaidOut: number;
  totalRefunded: number;
  pendingBalance: number;
  entriesCount: number;
}

export interface DriverBalance {
  driverId: string;
  balance: number;
  currency: string;
  entriesCount: number;
}

export interface RiderTransaction {
  id: string;
  bookingId: string;
  rideId: string;
  riderId: string;
  stripePaymentIntentId?: string | null;
  amountTotal: number;
  fareAmount: number;
  platformFeeAmount: number;
  currency: string;
  status: string;
  failureReason?: string | null;
  payoutEligibleAt?: string | null;
  createdAt: string;
  updatedAt: string;
  booking?: {
    id: string;
    status: string;
    pickupAddress?: string | null;
    dropoffAddress?: string | null;
    refundAmount?: number | null;
    refundPercent?: number | null;
    refundedAt?: string | null;
    cancelledAt?: string | null;
    disputes?: Array<{ id: string; status: string; reason: string }>;
    ride?: {
      id: string;
      originAddress: string;
      destinationAddress: string;
      departureDate: string;
      departureTime: string;
      driver?: { id: string; name: string | null };
    };
  };
}

export interface DriverEarningItem {
  id: string;
  bookingId: string;
  rideId: string;
  riderId: string;
  stripePaymentIntentId?: string | null;
  amountTotal: number;
  fareAmount: number;
  platformFeeAmount: number;
  currency: string;
  status: string;
  failureReason?: string | null;
  payoutEligibleAt?: string | null;
  createdAt: string;
  updatedAt: string;
  booking?: {
    id: string;
    status: string;
    pickupAddress?: string | null;
    dropoffAddress?: string | null;
    completedAt?: string | null;
    refundAmount?: number | null;
    refundedAt?: string | null;
    passenger?: { id: string; name: string | null };
    disputes?: Array<{ id: string; status: string; reason: string }>;
    ride?: {
      id: string;
      originAddress: string;
      destinationAddress: string;
      departureDate: string;
      departureTime: string;
    };
  };
  payoutItems?: Array<{
    id: string;
    status: string;
    driverAmount: number;
    platformFee: number;
    batch?: {
      id: string;
      status: string;
      stripeTransferId?: string | null;
      createdAt: string;
    };
  }>;
}

export interface PayoutRecord {
  id: string;
  driverId?: string;
  currency: string;
  status: string;
  amountTotal: number;
  stripeTransferId?: string | null;
  stripePayoutId?: string | null;
  failureReason?: string | null;
  createdAt: string;
  updatedAt?: string;
  items: Array<{
    id: string;
    bookingId: string;
    paymentId: string;
    driverAmount: number;
    platformFee: number;
    status: string;
    createdAt: string;
  }>;
}

export interface Dispute {
  id: string;
  rideId: string;
  bookingId: string;
  raisedBy?: string;
  reason: string;
  description?: string;
  status: string;
  recommendation?: string;
  riskScore?: number;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
  booking?: { id: string; passengerId: string; totalPrice: number; status: string };
  ride?: { id: string; driverId: string; originAddress: string; destinationAddress: string; departureDate?: string; departureTime?: string };
}

export interface PaymentMethod {
  id: string;
  stripeCustomerId?: string;
  stripePaymentMethodId?: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
}

export interface LocationUpdateRecord {
  rideId: string;
  lat: number;
  lng: number;
  speed?: number | null;
  heading?: number | null;
  accuracy?: number | null;
  timestamp: string;
  recorded?: boolean;
}

export interface TrackingLink {
  id: string;
  token: string;
  expiresAt: string;
  accessScope: string;
  trackingUrl?: string;
  createdAt?: string;
}

export interface PublicTrackingData {
  rideId: string;
  bookingId: string;
  bookingStatus: string;
  rideStatus: string;
  originAddress: string;
  destinationAddress: string;
  pickup: string | null;
  dropoff: string | null;
  departureDate?: string;
  departureTime: string;
  location: LocationUpdateRecord | null;
  eta?: {
    pickup: { distanceMeters: number; minutes: number; label: string } | null;
    dropoff: { distanceMeters: number; minutes: number; label: string } | null;
    scheduledPickupTime?: string | null;
    scheduledDropoffTime?: string | null;
  };
  accessScope: string;
}

export interface NotificationRecord {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface ContentPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  category: 'Rider guide' | 'Driver guide' | 'Safety' | 'Product update';
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: string | null;
  readTime: string;
  locale: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  updatedBy: string;
}

export interface ContentAuditLog {
  id: string;
  postId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  actorId: string;
  snapshot: ContentPost | null;
  createdAt: string;
}

export interface AdminPayoutCandidate {
  driverId: string;
  driverName: string | null;
  stripeAccountId: string | null;
  stripeOnboardingComplete: boolean;
  currency: string;
  amountTotal: number;
  paymentsCount: number;
  payments: Array<{
    id: string;
    bookingId: string;
    rideId: string;
    amountTotal: number;
    fareAmount: number;
    platformFeeAmount: number;
    currency: string;
    status: string;
    payoutEligibleAt?: string | null;
    booking?: {
      id: string;
      status: string;
      passenger?: { id: string; name: string | null };
      ride?: {
        id: string;
        originAddress: string;
        destinationAddress: string;
        departureDate: string;
        departureTime: string;
      };
    };
  }>;
}

// Search & Booking types
export interface SearchRidesParams {
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  departureDate: string;
  seatsRequired?: number;
  femaleOnly?: boolean;
  maxPrice?: number;
  sortBy?: 'price' | 'departure' | 'distance';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  radiusKm?: number;
}

export interface SearchRideResult {
  id: string;
  driverId: string;
  driver: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
    rating?: number;
    ratingCount?: number;
    successfulPublishedRides?: number;
    successfulCompletedRides?: number;
  };
  vehicle?: { brand: string | null; model_name?: string | null; type: string | null; color: string | null; imageUrl: string | null } | null;
  originAddress: string;
  destinationAddress: string;
  routeDistanceMeters: number | null;
  routeDurationSeconds: number | null;
  departureDate: string;
  departureTime: string;
  availableSeats: number;
  basePricePerSeat: number;
  currency: string;
  status: string;
  femaleOnly?: boolean;
  noSmoking?: boolean;
  noBicycles?: boolean;
  childSeatAvailable?: boolean;
  matchType?: string;
  score?: number;
  bookingContext?: { rideId: string; pickupWaypointId: string | null; dropoffWaypointId: string | null };
  segment?: { segmentFare: number };
  segmentId?: string;
  isSegmentView?: boolean;
}

export interface SearchRidesResponse {
  rides: SearchRideResult[];
  pagination: Pagination;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface RideDetails extends SearchRideResult {
  notes: string | null;
  totalSeats: number;
  waypoints: WaypointInfo[];
}

export interface WaypointInfo {
  id: string;
  placeId: string;
  address: string;
  lat: number;
  lng: number;
  waypointType: string;
  orderIndex: number;
  pricePerSeat: number | null;
  estimatedArrivalTime?: string | null;
}

export interface RecentSearch {
  id: string;
  originAddress: string;
  originLat: number;
  originLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  searchedAt: string;
}

export interface PricePreview {
  priceBreakdown: {
    basePricePerSeat: number;
    seatsBooked: number;
    subtotal: number;
    luggageFee: number;
    serviceFee: number;
    totalPrice: number;
    currency: string;
  };
  ride: {
    id: string;
    originAddress: string;
    destinationAddress: string;
    basePricePerSeat: number;
    currency: string;
    availableSeats: number;
  };
  segmentRide?: {
    originAddress: string;
    originLat?: number;
    originLng?: number;
    destinationAddress: string;
    destinationLat?: number;
    destinationLng?: number;
    basePricePerSeat: number;
  } | null;
}

export interface CreateBookingInput {
  rideId: string;
  segmentId?: string;
  seatsBooked: number;
  luggageCount?: number;
  pickupWaypointId?: string;
  dropoffWaypointId?: string;
  notes?: string;
  responseExpiryOption?: 'ONE_HOUR' | 'THREE_HOURS' | 'SIX_HOURS' | 'TWELVE_HOURS' | 'TWENTY_FOUR_HOURS' | 'BEFORE_DEPARTURE';
}

export interface Booking {
  id: string;
  rideId: string;
  passengerId: string;
  seatsBooked: number;
  totalPrice: number;
  priceBreakdown?: {
    basePricePerSeat: number;
    seatsBooked: number;
    subtotal: number;
    luggageFee: number;
    serviceFee: number;
    totalPrice: number;
    currency: string;
  };
  status: string;
  displayStatus?: string;
  pickupWaypointId: string | null;
  dropoffWaypointId: string | null;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
  luggageCount?: number;
  decisionDeadline?: {
    deadlineAt: string;
    timeRemainingMs: number;
    timeRemainingSeconds: number;
    isExpired: boolean;
    canExtend?: boolean;
    hasBeenExtended?: boolean;
    autoCancelAt?: string | null;
    autoCancelTimeRemainingMs?: number | null;
    autoCancelTimeRemainingSeconds?: number | null;
  } | null;
  payment?: {
    provider: 'stripe';
    paymentIntentId: string;
    clientSecret?: string;
    currency?: string;
  } | null;
  ride?: {
    id: string;
    originAddress: string;
    originLat?: number;
    originLng?: number;
    destinationAddress: string;
    destinationLat?: number;
    destinationLng?: number;
    departureDate: string;
    departureTime: string;
    status?: string;
    driver?: { name: string | null; avatarUrl: string | null };
    vehicle?: { brand: string | null; model_name: string | null; color: string | null } | null;
  };
  fullRide?: Booking['ride'];
  segmentRide?: {
    originAddress: string;
    originLat?: number;
    originLng?: number;
    destinationAddress: string;
    destinationLat?: number;
    destinationLng?: number;
    basePricePerSeat: number;
    bookingContext?: {
      pickupWaypointId: string | null;
      dropoffWaypointId: string | null;
    };
    segment?: {
      segmentFare: number;
      pickupAddress?: string;
      dropoffAddress?: string;
    };
  } | null;
  pickupOtp?: string | null;
  dropOtp?: string | null;
}

// Types
export interface PlacePrediction {
  description: string;
  placeId: string;
}

export interface RouteOption {
  index: number;
  polyline: string;
  distanceMeters: number;
  durationSeconds: number;
  distanceText: string;
  durationText: string;
}

export interface StopoverSuggestion {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceFromOriginKm: number;
  pricePerSeat?: number;
  estimatedArrivalTime?: string;
}

export interface LocationInput {
  placeId: string;
  address: string;
  lat: number;
  lng: number;
  estimatedArrivalTime?: string;
}

export interface DraftRide {
  originPlaceId?: string;
  originAddress?: string;
  originLat?: number;
  originLng?: number;
  destinationPlaceId?: string;
  destinationAddress?: string;
  destinationLat?: number;
  destinationLng?: number;
  departureDate?: string;
  departureTime?: string;
  totalSeats?: number;
  maxLuggagePerPerson?: number;
  backSeatOnly?: boolean;
  noSmoking?: boolean;
  noBicycles?: boolean;
  childSeatAvailable?: boolean;
  basePricePerSeat?: number;
  notes?: string;
  femaleOnly?: boolean;
  routePolyline?: string;
  routeDistanceMeters?: number;
  routeDurationSeconds?: number;
  stopovers?: LocationInput[];
  completionPercentage?: number;
}

export interface PriceRecommendation {
  recommendedPrice: number;
  minPrice: number;
  maxPrice: number;
  currency: string;
  breakdown: {
    fuelCost: number;
    distanceKm: number;
    pricePerKm: number;
  };
}

export interface PublishedRide {
  id: string;
  originAddress: string;
  destinationAddress: string;
  departureDate: string;
  departureTime: string;
  totalSeats: number;
  availableSeats: number;
  basePricePerSeat: number;
  currency: string;
  status: string;
  notes?: string;
  routeDistanceMeters?: number;
  routeDurationSeconds?: number;
  noSmoking?: boolean;
  noBicycles?: boolean;
  childSeatAvailable?: boolean;
}

export interface DriverRideBooking {
  id: string;
  rideId: string;
  passengerId: string;
  passenger?: { id: string; name: string | null; avatarUrl: string | null };
  seatsBooked: number;
  totalPrice: number;
  status: string;
  displayStatus?: string;
  decisionDeadline?: {
    deadlineAt: string;
    timeRemainingMs: number;
    timeRemainingSeconds: number;
    isExpired: boolean;
    canExtend?: boolean;
    hasBeenExtended?: boolean;
    autoCancelAt?: string | null;
    autoCancelTimeRemainingMs?: number | null;
    autoCancelTimeRemainingSeconds?: number | null;
  } | null;
  pickupWaypointId: string | null;
  dropoffWaypointId: string | null;
  pickupLocation?: { address: string; placeId: string; lat?: number; lng?: number; estimatedArrivalTime?: string | null };
  dropoffLocation?: { address: string; placeId: string; lat?: number; lng?: number; estimatedArrivalTime?: string | null };
  createdAt?: string;
}

export interface DriverPublishedRide extends PublishedRide {
  waypoints?: WaypointInfo[];
  bookings?: DriverRideBooking[];
  vehicle?: { id: string; brand: string | null; model_num: string | null; model_name: string | null; type: string | null; color: string | null; year: number | null; imageUrl: string | null; isVerified: boolean } | null;
}

// Types
export interface UserProfile {
  id: string;
  email?: string;
  phone?: string;
  name?: string;
  nickName?: string;
  salutation?: string | null;
  gender?: 'MALE' | 'FEMALE' | 'NON_BINARY' | 'OTHER' | 'PREFER_NOT_TO_SAY' | null;
  avatarUrl?: string;
  role: 'USER' | 'ADMIN';
  onboardingStatus: 'PENDING' | 'COMPLETED';
  isVerified: boolean;
  tosAcceptedAt?: string | null;
  privacyAcceptedAt?: string | null;
}

export interface UserFullProfile extends UserProfile {
  salutation?: string;
  gender?: 'MALE' | 'FEMALE' | 'NON_BINARY' | 'OTHER' | 'PREFER_NOT_TO_SAY' | null;
  dob?: string;
  travelPreference?: {
    chattiness: string | null;
    pets: string | null;
  };
  vehicles?: Array<{
    id: string;
    brand: string;
    model: string;
    color: string;
    yearMake: number;
  }>;
  stats?: {
    totalRides: number;
    totalBookings: number;
    successfulPublishedRides?: number;
    successfulCompletedRides?: number;
    memberSince: string;
  };
  rating?: { average: number | null; total: number; label: string | null };
}

export interface UserProfileUpdate {
  name: string;
  nickName: string;
  salutation: string;
  dob: string;
}

export interface OnboardingData {
  name: string;
  nickName?: string;
  salutation?: string;
  gender?: 'MALE' | 'FEMALE' | 'NON_BINARY' | 'OTHER' | 'PREFER_NOT_TO_SAY';
  dob?: string;
}

export interface Vehicle {
  id: string;
  brand: string | null;
  model_num: string | null;
  model_name: string | null;
  type: VehicleType | null;
  color: string | null;
  year: number | null;
  imageUrl: string | null;
  isVerified: boolean;
  licenseCountry?: string;
  licenseNumber?: string;
}

export interface VehicleDraft {
  licenseCountry: string;
  licenseNumber: string;
  brand: string | null;
  model_num: string | null;
  model_name: string | null;
  type: VehicleType | null;
  color: string | null;
  year: number | null;
  documents: Array<{ imageUrl: string; documentType: string }>;
}

export interface VehicleDetails {
  brand: string;
  model_num: string;
  model_name: string;
  type: VehicleType;
  color: string;
  year: number;
}

export type VehicleType = 'sedan' | 'hatchback' | 'suv' | 'minibus' | 'coupe' | 'convertible' | 'pickup' | 'van' | 'truck';

export interface TravelPreference {
  id: string;
  userId: string;
  chattiness: Chattiness | null;
  pets: PetsPreference | null;
}

export interface TravelPreferenceUpdate {
  chattiness?: Chattiness;
  pets?: PetsPreference;
}

export type Chattiness = 'quiet' | 'chatty_when_comfortable' | 'chatterbox';
export type PetsPreference = 'love_pets' | 'no_pets' | 'depends_on_animal';
