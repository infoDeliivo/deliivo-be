# View User Profile API Proposal

## Overview
This proposal outlines a new API endpoint that allows authenticated users to view detailed public profile information of other users in the carpooling platform. This feature enables users to make informed decisions about who they're traveling with by viewing ratings, travel preferences, and other relevant details.

---

## Business Context

### Use Cases
1. **Pre-Booking Research**: Passengers can view driver profiles before booking a ride
2. **Driver Verification**: Drivers can view passenger profiles before accepting bookings
3. **Trust Building**: Users can assess compatibility through travel preferences and ratings
4. **Safety**: Users can make informed decisions based on other users' ratings and history

### User Stories
- As a **passenger**, I want to view a driver's profile to see their ratings and travel preferences before booking
- As a **driver**, I want to view a passenger's profile to understand their travel habits and ratings
- As a **user**, I want to see how many rides/bookings another user has completed to assess their experience

---

## API Specification

### Endpoint
```
GET /api/v1/users/{userId}/profile
```

### Authentication
- **Required**: Yes (Bearer token)
- **Authorization**: Any authenticated user can view any other user's public profile

### Path Parameters
| Parameter | Type   | Required | Description                    |
|-----------|--------|----------|--------------------------------|
| userId    | string | Yes      | UUID of the user to view       |

### Response Structure

#### Success Response (200 OK)
```json
{
  "success": true,
  "message": "User profile fetched successfully",
  "data": {
    "user": {
      "id": "user-uuid-123",
      "name": "John Doe",
      "nickName": "johnd",
      "avatarUrl": "https://s3.amazonaws.com/avatars/user-123.jpg",
      "isVerified": true,
      "memberSince": "2025-01-15T10:30:00.000Z"
    },
    "travelPreference": {
      "id": "pref-uuid-456",
      "chattiness": "MEDIUM",
      "pets": "YES"
    },
    "vehicle": {
      "id": "vehicle-uuid-789",
      "brand": "Toyota",
      "model_num": "Camry",
      "type": "sedan",
      "color": "Silver",
      "imageUrl": "https://s3.amazonaws.com/vehicles/vehicle-789.jpg",
      "isVerified": true
    },
    "stats": {
      "totalRides": 45,
      "totalBookings": 23,
      "memberSince": "2025-01-15T10:30:00.000Z"
    },
    "rating": {
      "average": 4.75,
      "total": 68,
      "label": null
    }
  }
}
```

#### No Ratings Example
```json
{
  "rating": {
    "average": null,
    "total": 0,
    "label": "No ratings yet"
  }
}
```

### Error Responses

#### 401 Unauthorized
```json
{
  "success": false,
  "message": "Authentication required"
}
```

#### 404 Not Found
```json
{
  "success": false,
  "message": "User not found"
}
```

#### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Server error"
}
```

---

## Data Privacy & Security

### Public Information (Included)
- ✅ Name
- ✅ Nickname
- ✅ Avatar URL
- ✅ Verification status
- ✅ Member since date
- ✅ Travel preferences (chattiness, pets)
- ✅ Vehicle details (if driver)
- ✅ Ride/booking statistics
- ✅ Rating summary (average, total count)

### Private Information (Excluded)
- ❌ Email address
- ❌ Phone number
- ❌ Date of birth
- ❌ Salutation
- ❌ Email/phone verification status
- ❌ Onboarding status
- ❌ Individual rating reviews (only aggregate shown)

---

## Technical Implementation

### Database Schema
**No changes required** - All data exists in current schema:
- `User` table: Basic info
- `TravelPreference` table: Travel preferences
- `Vehicle` table: Vehicle details
- `UserRatingStats` table: Aggregate ratings
- `Ride` table: Count for totalRides
- `RideBooking` table: Count for totalBookings

### Implementation Files

#### 1. Types (`src/modules/user/user.types.ts`)
```typescript
// Public profile response (subset of FullProfileResponse)
export interface PublicProfileResponse {
  user: {
    id: string;
    name: string | null;
    nickName: string | null;
    avatarUrl: string | null;
    isVerified: boolean;
    memberSince: Date;
  };
  travelPreference: TravelPreferenceData | null;
  vehicle: VehicleSummary | null;
  stats: UserStats;
  rating: UserRatingSummary;
}
```

#### 2. Service (`src/modules/user/user.service.ts`)
```typescript
export const getPublicProfileService = async (
  userId: string
): Promise<ServiceResult<PublicProfileResponse>> => {
  // Similar to getFullProfileService but:
  // 1. Exclude sensitive fields (email, phone, dob, salutation)
  // 2. Include only public user info
  // 3. Include all other data (preferences, vehicle, stats, ratings)
}
```

#### 3. Controller (`src/modules/user/user.controller.ts`)
```typescript
export const getPublicProfile = async (req: AuthRequest, res: Response) => {
  // 1. Extract userId from req.params
  // 2. Check cache first (cacheKeys.publicProfile(userId))
  // 3. Call getPublicProfileService
  // 4. Cache result with 5-min TTL
  // 5. Return response
}
```

#### 4. Routes (`src/modules/user/user.routes.ts`)
```typescript
router.get(
  '/users/:userId/profile',
  authenticate,
  getPublicProfile
);
```

#### 5. Cache Service (`src/services/cache.service.ts`)
```typescript
export const cacheKeys = {
  // ... existing keys
  publicProfile: (userId: string) => `user:${userId}:public-profile`,
};
```

### Cache Strategy
- **Cache Key**: `user:{userId}:public-profile`
- **TTL**: 300 seconds (5 minutes)
- **Invalidation**: When user updates profile, ratings are submitted, or vehicle is modified

### Performance Considerations
1. **Single Optimized Query**: Use Prisma `include` to fetch all related data in one query
2. **Parallel Aggregation**: Count rides and bookings in parallel with main query
3. **Redis Caching**: Cache public profiles to reduce database load
4. **Index Usage**: Leverage existing indexes on userId, status fields

---

## OpenAPI Documentation

### Path Definition (`docs/openapi/paths/users.yaml`)
```yaml
"/api/v1/users/{userId}/profile":
  get:
    operationId: usersGetUserProfile
    summary: GET users/{userId}/profile
    description: View public profile of another user
    tags:
      - Users
    security:
      - BearerAuth: []
    parameters:
      - name: userId
        in: path
        required: true
        schema:
          type: string
          format: uuid
        description: ID of the user whose profile to view
    responses:
      200:
        description: Success
        content:
          application/json:
            schema:
              $ref: "../components/schemas/common.yaml#/ApiSuccessEnvelope"
            examples:
              default:
                $ref: "../components/examples/common.yaml#/PublicProfileSuccess"
      401:
        $ref: "../components/responses/errors.yaml#/Unauthorized"
      404:
        $ref: "../components/responses/errors.yaml#/NotFound"
      500:
        $ref: "../components/responses/errors.yaml#/ServerError"
```

### Example Response (`docs/openapi/components/examples/common.yaml`)
```yaml
PublicProfileSuccess:
  value:
    success: true
    message: "User profile fetched successfully"
    data:
      user:
        id: "user-uuid-123"
        name: "John Doe"
        nickName: "johnd"
        avatarUrl: "https://s3.amazonaws.com/avatars/user-123.jpg"
        isVerified: true
        memberSince: "2025-01-15T10:30:00.000Z"
      travelPreference:
        id: "pref-uuid-456"
        chattiness: "MEDIUM"
        pets: "YES"
      vehicle:
        id: "vehicle-uuid-789"
        brand: "Toyota"
        model_num: "Camry"
        type: "sedan"
        color: "Silver"
        imageUrl: "https://s3.amazonaws.com/vehicles/vehicle-789.jpg"
        isVerified: true
      stats:
        totalRides: 45
        totalBookings: 23
        memberSince: "2025-01-15T10:30:00.000Z"
      rating:
        average: 4.75
        total: 68
        label: null
```

---

## Testing Strategy

### Unit Tests
1. **Service Layer** (`user.service.test.ts`)
   - Test successful profile fetch
   - Test user not found scenario
   - Test profile with no ratings
   - Test profile with no vehicle
   - Test profile with no travel preferences

2. **Controller Layer** (`user.controller.test.ts`)
   - Test cache hit scenario
   - Test cache miss scenario
   - Test error handling
   - Test response format

### Integration Tests
1. **API Endpoint** (`user.integration.test.ts`)
   - Test authenticated request
   - Test unauthenticated request (401)
   - Test invalid userId (404)
   - Test response data structure
   - Test privacy (no sensitive data exposed)

### Property-Based Tests
1. **Privacy Validation**
   - For any user profile, verify no email/phone/dob is exposed
2. **Data Consistency**
   - Verify rating stats match UserRatingStats table
   - Verify ride/booking counts are accurate

---

## Implementation Checklist

### Phase 1: Core Implementation
- [ ] Add `PublicProfileResponse` type to `user.types.ts`
- [ ] Implement `getPublicProfileService` in `user.service.ts`
- [ ] Implement `getPublicProfile` controller in `user.controller.ts`
- [ ] Add route in `user.routes.ts`
- [ ] Add cache key in `cache.service.ts`

### Phase 2: Documentation
- [ ] Add OpenAPI path definition in `users.yaml`
- [ ] Add example response in `common.yaml`
- [ ] Update API documentation

### Phase 3: Testing
- [ ] Write unit tests for service layer
- [ ] Write unit tests for controller layer
- [ ] Write integration tests for endpoint
- [ ] Write property-based tests for privacy

### Phase 4: Cache Invalidation
- [ ] Invalidate public profile cache on user profile update
- [ ] Invalidate public profile cache on rating submission
- [ ] Invalidate public profile cache on vehicle update

---

## Future Enhancements

### Phase 2 Features (Optional)
1. **Recent Reviews**: Show last 3-5 reviews (not just aggregate)
2. **Badges**: Display achievements (e.g., "100+ rides", "5-star driver")
3. **Response Rate**: Show how quickly user responds to messages
4. **Verification Details**: Show what documents are verified
5. **Common Routes**: Display frequently traveled routes (for drivers)

### Privacy Controls (Future)
1. **Profile Visibility Settings**: Allow users to hide certain fields
2. **Block List**: Prevent blocked users from viewing profile
3. **Anonymous Mode**: Hide profile from non-connected users

---

## Comparison: Own Profile vs Public Profile

| Field                  | Own Profile (GET /me/profile) | Public Profile (GET /users/{id}/profile) |
|------------------------|-------------------------------|------------------------------------------|
| Name                   | ✅ Included                    | ✅ Included                               |
| Nickname               | ✅ Included                    | ✅ Included                               |
| Email                  | ✅ Included (with verification)| ❌ Hidden                                 |
| Phone                  | ✅ Included (with verification)| ❌ Hidden                                 |
| Date of Birth          | ✅ Included                    | ❌ Hidden                                 |
| Salutation             | ✅ Included                    | ❌ Hidden                                 |
| Avatar URL             | ✅ Included                    | ✅ Included                               |
| Verification Status    | ✅ Included                    | ✅ Included                               |
| Onboarding Status      | ✅ Included                    | ❌ Hidden                                 |
| Travel Preferences     | ✅ Included                    | ✅ Included                               |
| Vehicle Details        | ✅ Included                    | ✅ Included                               |
| Stats (Rides/Bookings) | ✅ Included                    | ✅ Included                               |
| Rating Summary         | ✅ Included                    | ✅ Included                               |
| Member Since           | ✅ Included                    | ✅ Included                               |

---

## Security Considerations

### Rate Limiting
- Implement rate limiting to prevent profile scraping
- Suggested limit: 100 requests per hour per user

### Audit Logging
- Log all profile view requests for security monitoring
- Track suspicious patterns (e.g., viewing 100+ profiles in short time)

### Data Minimization
- Only expose data necessary for carpooling decisions
- Regularly review what data is public vs private

---

## Conclusion

This API endpoint provides essential functionality for users to make informed decisions about their carpooling partners while maintaining strong privacy protections. The implementation leverages existing database schema and follows established patterns in the codebase for consistency and maintainability.

**Estimated Implementation Time**: 4-6 hours
**Complexity**: Low-Medium
**Dependencies**: None (uses existing schema)
**Breaking Changes**: None
