# Public Profile API - Quick Start Guide

## Endpoint
```
GET /api/v1/users/{userId}/profile
```

## Authentication
**Required:** Yes - Bearer token in Authorization header

## Usage

### Basic Request
```bash
curl -X GET "http://localhost:3000/api/v1/users/USER_ID_HERE/profile" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Example with Real Data
```bash
# Replace these values:
# - USER_ID: The UUID of the user you want to view
# - ACCESS_TOKEN: Your authentication token

curl -X GET "http://localhost:3000/api/v1/users/11111111-1111-1111-1111-111111111111/profile" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## Response

### Success (200 OK)
```json
{
  "success": true,
  "message": "User profile fetched successfully",
  "data": {
    "user": {
      "id": "11111111-1111-1111-1111-111111111111",
      "name": "John Doe",
      "nickName": "johnd",
      "avatarUrl": "https://cdn.example.com/avatar.jpg",
      "isVerified": true,
      "memberSince": "2025-01-15T10:30:00.000Z"
    },
    "travelPreference": {
      "id": "22222222-2222-2222-2222-222222222222",
      "chattiness": "MEDIUM",
      "pets": "YES"
    },
    "vehicle": {
      "id": "33333333-3333-3333-3333-333333333333",
      "brand": "Toyota",
      "model_num": "Camry",
      "type": "sedan",
      "color": "Silver",
      "imageUrl": "https://cdn.example.com/vehicle.jpg",
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

### User Not Found (404)
```json
{
  "success": false,
  "message": "User not found"
}
```

### Unauthorized (401)
```json
{
  "success": false,
  "message": "Authentication required"
}
```

## What's Included

### ✅ Public Information
- Name, nickname, avatar
- Verification status
- Member since date
- Travel preferences (chattiness, pets)
- Vehicle details (brand, model, type, color, image)
- Statistics (total rides as driver, total bookings as passenger)
- Rating summary (average rating, total count)

### ❌ Private Information (NOT Included)
- Email address
- Phone number
- Date of birth
- Salutation
- Email/phone verification status
- Onboarding status

## Use Cases

### 1. View Driver Profile Before Booking
```javascript
// Frontend example
const viewDriverProfile = async (driverId) => {
  const response = await fetch(`/api/v1/users/${driverId}/profile`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  const data = await response.json();
  
  // Display driver info
  console.log(`Driver: ${data.data.user.name}`);
  console.log(`Rating: ${data.data.rating.average} (${data.data.rating.total} reviews)`);
  console.log(`Total Rides: ${data.data.stats.totalRides}`);
};
```

### 2. View Passenger Profile Before Accepting Booking
```javascript
// Frontend example
const viewPassengerProfile = async (passengerId) => {
  const response = await fetch(`/api/v1/users/${passengerId}/profile`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  const data = await response.json();
  
  // Display passenger info
  console.log(`Passenger: ${data.data.user.name}`);
  console.log(`Rating: ${data.data.rating.average || 'No ratings yet'}`);
  console.log(`Total Bookings: ${data.data.stats.totalBookings}`);
  console.log(`Chattiness: ${data.data.travelPreference?.chattiness}`);
};
```

## Caching

- **Cache Duration:** 5 minutes
- **Cache Key:** `user:{userId}:public-profile`
- **Automatic Invalidation:** Cache is cleared when user updates profile, receives ratings, or uploads avatar

## Performance

- **First Request:** ~200-500ms (database query)
- **Cached Request:** ~50-100ms (Redis cache)
- **Optimized:** Single database query with parallel aggregation

## Testing

### Test with Postman
1. Create a new GET request
2. URL: `http://localhost:3000/api/v1/users/{userId}/profile`
3. Headers:
   - `Authorization: Bearer YOUR_TOKEN`
4. Send request

### Test with JavaScript
```javascript
const axios = require('axios');

const getUserProfile = async (userId, token) => {
  try {
    const response = await axios.get(
      `http://localhost:3000/api/v1/users/${userId}/profile`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    console.log('Profile:', response.data);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
};

// Usage
getUserProfile('user-id-here', 'your-token-here');
```

## Common Errors

### 400 Bad Request
- **Cause:** Missing or invalid userId parameter
- **Solution:** Ensure userId is a valid UUID

### 401 Unauthorized
- **Cause:** Missing or invalid authentication token
- **Solution:** Include valid Bearer token in Authorization header

### 404 Not Found
- **Cause:** User with given ID doesn't exist
- **Solution:** Verify the userId is correct

### 500 Internal Server Error
- **Cause:** Server error (database connection, etc.)
- **Solution:** Check server logs for details

## Integration with Existing Features

### With Ride Search
When displaying search results, show driver profiles:
```javascript
const rides = await searchRides();
for (const ride of rides) {
  const driverProfile = await getUserProfile(ride.driverId);
  // Display driver rating and stats
}
```

### With Booking Flow
Before confirming booking, show driver profile:
```javascript
const confirmBooking = async (rideId, driverId) => {
  // Show driver profile first
  const driverProfile = await getUserProfile(driverId);
  
  // User reviews profile and confirms
  if (userConfirms) {
    await createBooking(rideId);
  }
};
```

### With Chat
Show user profile in chat interface:
```javascript
const openChat = async (userId) => {
  const userProfile = await getUserProfile(userId);
  // Display profile info in chat header
  // Show rating, verification status, etc.
};
```

## Next Steps

1. **Test the endpoint** with your authentication token
2. **Integrate into frontend** to display user profiles
3. **Add UI components** to show ratings, stats, and preferences
4. **Implement profile viewing** in ride search and booking flows

## Support

For issues or questions:
- Check `TEST_PUBLIC_PROFILE_API.md` for detailed test cases
- Review `PUBLIC_PROFILE_IMPLEMENTATION_SUMMARY.md` for technical details
- See `VIEW_USER_PROFILE_API_PROPOSAL.md` for complete specification
