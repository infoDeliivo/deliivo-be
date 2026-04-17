# Test: Public Profile API

## Overview
This document provides test cases for the new **View User Profile** API endpoint that allows users to view public profiles of other users.

## Endpoint
```
GET /api/v1/users/{userId}/profile
```

## Test Cases

### 1. View Public Profile - Success (User with Ratings)

**Request:**
```bash
curl -X GET "http://localhost:3000/api/v1/users/{userId}/profile" \
  -H "Authorization: Bearer {access_token}"
```

**Expected Response (200 OK):**
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

**Verification:**
- ✅ Response includes public user info (name, nickname, avatar, verification status)
- ✅ Response includes travel preferences
- ✅ Response includes vehicle details
- ✅ Response includes statistics (totalRides, totalBookings)
- ✅ Response includes rating summary with average and total
- ❌ Response does NOT include email, phone, dob, salutation

---

### 2. View Public Profile - User with No Ratings

**Request:**
```bash
curl -X GET "http://localhost:3000/api/v1/users/{newUserId}/profile" \
  -H "Authorization: Bearer {access_token}"
```

**Expected Response (200 OK):**
```json
{
  "success": true,
  "message": "User profile fetched successfully",
  "data": {
    "user": {
      "id": "new-user-uuid",
      "name": "Jane Smith",
      "nickName": "janes",
      "avatarUrl": null,
      "isVerified": false,
      "memberSince": "2026-04-01T08:00:00.000Z"
    },
    "travelPreference": null,
    "vehicle": null,
    "stats": {
      "totalRides": 0,
      "totalBookings": 0,
      "memberSince": "2026-04-01T08:00:00.000Z"
    },
    "rating": {
      "average": null,
      "total": 0,
      "label": "No ratings yet"
    }
  }
}
```

**Verification:**
- ✅ Rating shows "No ratings yet" label when total = 0
- ✅ Rating average is null when no ratings exist
- ✅ Travel preference is null if not set
- ✅ Vehicle is null if user has no vehicle

---

### 3. View Public Profile - User Not Found

**Request:**
```bash
curl -X GET "http://localhost:3000/api/v1/users/invalid-user-id/profile" \
  -H "Authorization: Bearer {access_token}"
```

**Expected Response (404 Not Found):**
```json
{
  "success": false,
  "message": "User not found"
}
```

---

### 4. View Public Profile - Unauthenticated

**Request:**
```bash
curl -X GET "http://localhost:3000/api/v1/users/{userId}/profile"
```

**Expected Response (401 Unauthorized):**
```json
{
  "success": false,
  "message": "Authentication required"
}
```

---

### 5. View Public Profile - Cached Response

**Request (Second call to same user):**
```bash
curl -X GET "http://localhost:3000/api/v1/users/{userId}/profile" \
  -H "Authorization: Bearer {access_token}"
```

**Expected Response (200 OK):**
```json
{
  "success": true,
  "message": "User profile fetched successfully (cached)",
  "data": {
    // ... same data as first call
  }
}
```

**Verification:**
- ✅ Response message indicates "(cached)"
- ✅ Response is faster than first call
- ✅ Data is identical to first call

---

## Privacy Verification Tests

### Test: Sensitive Data Not Exposed

**Objective:** Verify that private information is NOT included in public profile response

**Steps:**
1. Create a user with complete profile (email, phone, dob, salutation)
2. Call GET /api/v1/users/{userId}/profile
3. Verify response does NOT contain:
   - email
   - phone
   - dob (date of birth)
   - salutation
   - emailVerified
   - phoneVerified
   - onboardingStatus

**Expected Result:**
```json
{
  "data": {
    "user": {
      "id": "...",
      "name": "...",
      "nickName": "...",
      "avatarUrl": "...",
      "isVerified": true,
      "memberSince": "..."
      // NO email, phone, dob, salutation
    }
  }
}
```

---

## Cache Invalidation Tests

### Test 1: Cache Invalidated on Profile Update

**Steps:**
1. View user's public profile (cached)
2. User updates their profile (name, nickname, etc.)
3. View user's public profile again

**Expected Result:**
- ✅ Second call returns updated data
- ✅ Cache was invalidated after profile update

---

### Test 2: Cache Invalidated on Rating Submission

**Steps:**
1. View user's public profile (cached)
2. Submit a rating for that user
3. View user's public profile again

**Expected Result:**
- ✅ Second call returns updated rating stats
- ✅ Cache was invalidated after rating submission

---

### Test 3: Cache Invalidated on Avatar Upload

**Steps:**
1. View user's public profile (cached)
2. User uploads new avatar
3. View user's public profile again

**Expected Result:**
- ✅ Second call returns new avatar URL
- ✅ Cache was invalidated after avatar upload

---

## Performance Tests

### Test: Response Time

**Objective:** Verify API responds quickly with caching

**Steps:**
1. First call (cache miss): Measure response time
2. Second call (cache hit): Measure response time

**Expected Results:**
- First call: < 500ms
- Second call: < 100ms (cached)

---

### Test: Database Query Optimization

**Objective:** Verify single optimized query is used

**Steps:**
1. Enable database query logging
2. Call GET /api/v1/users/{userId}/profile
3. Count number of database queries

**Expected Result:**
- ✅ Maximum 4 queries (user with relations, ride count, booking count, rating stats)
- ✅ No N+1 query problems

---

## Integration Test Script

```bash
#!/bin/bash

# Set variables
BASE_URL="http://localhost:3000/api/v1"
ACCESS_TOKEN="your-access-token"
USER_ID="target-user-id"

echo "=== Testing Public Profile API ==="

# Test 1: View public profile
echo -e "\n1. View Public Profile (Success)"
curl -X GET "$BASE_URL/users/$USER_ID/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" | jq

# Test 2: View public profile (cached)
echo -e "\n2. View Public Profile (Cached)"
curl -X GET "$BASE_URL/users/$USER_ID/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" | jq

# Test 3: User not found
echo -e "\n3. User Not Found"
curl -X GET "$BASE_URL/users/invalid-user-id/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" | jq

# Test 4: Unauthenticated
echo -e "\n4. Unauthenticated Request"
curl -X GET "$BASE_URL/users/$USER_ID/profile" \
  -H "Content-Type: application/json" | jq

echo -e "\n=== Tests Complete ==="
```

---

## Manual Testing Checklist

- [ ] Test with user who has complete profile (all fields filled)
- [ ] Test with user who has minimal profile (only required fields)
- [ ] Test with user who has no ratings
- [ ] Test with user who has ratings
- [ ] Test with user who has no vehicle
- [ ] Test with user who has vehicle
- [ ] Test with user who has no travel preferences
- [ ] Test with user who has travel preferences
- [ ] Verify email/phone/dob are NOT exposed
- [ ] Verify cache works (second call is faster)
- [ ] Verify cache invalidation on profile update
- [ ] Verify cache invalidation on rating submission
- [ ] Verify cache invalidation on avatar upload
- [ ] Test with invalid user ID (404)
- [ ] Test without authentication (401)
- [ ] Test response time (< 500ms first call, < 100ms cached)

---

## Expected Behavior Summary

| Scenario | Expected Response | Status Code |
|----------|-------------------|-------------|
| Valid user with ratings | Full public profile with rating stats | 200 |
| Valid user without ratings | Full public profile with "No ratings yet" | 200 |
| User not found | Error message | 404 |
| Unauthenticated request | Error message | 401 |
| Cached request | Same data with "(cached)" message | 200 |
| Invalid user ID format | Error message | 400 or 404 |

---

## Notes

- Public profile excludes sensitive data (email, phone, dob, salutation)
- Cache TTL is 5 minutes
- Cache is invalidated on profile updates, rating submissions, and avatar uploads
- Response includes rating summary (average, total, label)
- Response includes statistics (totalRides, totalBookings, memberSince)
- Response includes travel preferences and vehicle details if available
