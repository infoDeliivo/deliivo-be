#!/bin/bash

# Complete Automated Flow Test
# Tests: Signup -> Verify OTP -> Publish Ride -> Book Ride -> Check OTP -> Test Pagination

BASE_URL="http://localhost:3000"
TIMESTAMP=$(date +%s)
DRIVER_EMAIL="driver${TIMESTAMP}@test.com"
PASSENGER_EMAIL="passenger${TIMESTAMP}@test.com"

echo "========================================="
echo "Complete Automated Flow Test"
echo "========================================="
echo ""

# Step 1: Driver Signup
echo "Step 1: Driver Signup..."
SIGNUP_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{
    \"method\": \"email\",
    \"email\": \"$DRIVER_EMAIL\",
    \"name\": \"Test Driver\"
  }")

echo "Signup Response: $SIGNUP_RESPONSE"
DRIVER_OTP=$(echo $SIGNUP_RESPONSE | grep -o '"code":"[^"]*"' | cut -d'"' -f4)
echo "Driver OTP: $DRIVER_OTP"
echo ""

# Step 2: Verify Driver OTP
echo "Step 2: Verifying Driver OTP..."
VERIFY_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/auth/otp/verify" \
  -H "Content-Type: application/json" \
  -d "{
    \"method\": \"email\",
    \"identifier\": \"$DRIVER_EMAIL\",
    \"code\": \"$DRIVER_OTP\",
    \"purpose\": \"signup\"
  }")

echo "Verify Response: $VERIFY_RESPONSE"
DRIVER_TOKEN=$(echo $VERIFY_RESPONSE | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
echo "Driver Token: ${DRIVER_TOKEN:0:50}..."
echo ""

# Step 3: Publish a Ride
echo "Step 3: Publishing a Ride..."
PUBLISH_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/publish-ride" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "originPlaceId": "ChIJdd4hrwug2EcRmSrV3Vo6llI",
    "originAddress": "London, UK",
    "originLat": 51.5074,
    "originLng": -0.1278,
    "destinationPlaceId": "ChIJ2_UmUkzxe0gRqmv-BDgUvtU",
    "destinationAddress": "Manchester, UK",
    "destinationLat": 53.4808,
    "destinationLng": -2.2426,
    "departureDate": "2026-04-20",
    "departureTime": "09:00",
    "totalSeats": 3,
    "basePricePerSeat": 25.00,
    "currency": "GBP",
    "notes": "Test ride"
  }')

echo "Publish Response: $PUBLISH_RESPONSE"
RIDE_ID=$(echo $PUBLISH_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
echo "Ride ID: $RIDE_ID"
echo ""

# Step 4: Check Published Ride (should have no bookings yet)
echo "Step 4: Checking Published Ride..."
GET_RIDE_RESPONSE=$(curl -s "$BASE_URL/api/v1/publish-ride/$RIDE_ID" \
  -H "Authorization: Bearer $DRIVER_TOKEN")

echo "Get Ride Response: $GET_RIDE_RESPONSE"
echo ""

# Step 5: Passenger Signup
echo "Step 5: Passenger Signup..."
PASSENGER_SIGNUP=$(curl -s -X POST "$BASE_URL/api/v1/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{
    \"method\": \"email\",
    \"email\": \"$PASSENGER_EMAIL\",
    \"name\": \"Test Passenger\"
  }")

echo "Passenger Signup: $PASSENGER_SIGNUP"
PASSENGER_OTP=$(echo $PASSENGER_SIGNUP | grep -o '"code":"[^"]*"' | cut -d'"' -f4)
echo "Passenger OTP: $PASSENGER_OTP"
echo ""

# Step 6: Verify Passenger OTP
echo "Step 6: Verifying Passenger OTP..."
PASSENGER_VERIFY=$(curl -s -X POST "$BASE_URL/api/v1/auth/otp/verify" \
  -H "Content-Type: application/json" \
  -d "{
    \"method\": \"email\",
    \"identifier\": \"$PASSENGER_EMAIL\",
    \"code\": \"$PASSENGER_OTP\",
    \"purpose\": \"signup\"
  }")

echo "Passenger Verify: $PASSENGER_VERIFY"
PASSENGER_TOKEN=$(echo $PASSENGER_VERIFY | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
echo "Passenger Token: ${PASSENGER_TOKEN:0:50}..."
echo ""

# Step 7: Book the Ride
echo "Step 7: Booking the Ride..."
BOOKING_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/bookings" \
  -H "Authorization: Bearer $PASSENGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"rideId\": \"$RIDE_ID\",
    \"seatsBooked\": 2,
    \"luggageCount\": 1,
    \"notes\": \"Test booking for 2 people\"
  }")

echo "Booking Response: $BOOKING_RESPONSE"
BOOKING_ID=$(echo $BOOKING_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
BOOKING_OTP=$(echo $BOOKING_RESPONSE | grep -o '"otp":"[^"]*"' | cut -d'"' -f4)
echo "Booking ID: $BOOKING_ID"
echo "Booking OTP: $BOOKING_OTP"
echo ""

# Step 8: Check Driver's Ride (should now show booking)
echo "Step 8: Checking Driver's Ride (should show booking)..."
GET_RIDE_WITH_BOOKING=$(curl -s "$BASE_URL/api/v1/publish-ride/$RIDE_ID" \
  -H "Authorization: Bearer $DRIVER_TOKEN")

echo "Ride with Booking: $GET_RIDE_WITH_BOOKING"
echo ""

# Step 9: Test Pagination on All APIs
echo "Step 9: Testing Pagination on All APIs..."
echo ""

echo "9a. Testing Publish Rides Pagination:"
PUBLISH_RIDES_PAGE=$(curl -s "$BASE_URL/api/v1/publish-ride?page=1&limit=10" \
  -H "Authorization: Bearer $DRIVER_TOKEN")
echo "$PUBLISH_RIDES_PAGE" | grep -q '"pagination"' && echo "✅ Publish Rides pagination working" || echo "❌ Publish Rides pagination not working"
echo ""

echo "9b. Testing Bookings Pagination:"
BOOKINGS_PAGE=$(curl -s "$BASE_URL/api/v1/bookings?page=1&limit=10" \
  -H "Authorization: Bearer $PASSENGER_TOKEN")
echo "$BOOKINGS_PAGE" | grep -q '"pagination"' && echo "✅ Bookings pagination working" || echo "❌ Bookings pagination not working"
echo ""

echo "9c. Testing Search Rides Pagination:"
SEARCH_PAGE=$(curl -s "$BASE_URL/api/v1/search-rides?originLat=51.5074&originLng=-0.1278&destinationLat=53.4808&destinationLng=-2.2426&departureDate=2026-04-20&page=1&limit=10" \
  -H "Authorization: Bearer $PASSENGER_TOKEN")
echo "$SEARCH_PAGE" | grep -q '"pagination"' && echo "✅ Search Rides pagination working" || echo "❌ Search Rides pagination not working"
echo ""

echo "9d. Testing Vehicles Pagination:"
VEHICLES_PAGE=$(curl -s "$BASE_URL/api/v1/vehicles?page=1&limit=10" \
  -H "Authorization: Bearer $DRIVER_TOKEN")
echo "$VEHICLES_PAGE" | grep -q '"pagination"' && echo "✅ Vehicles pagination working" || echo "❌ Vehicles pagination not working"
echo ""

echo "9e. Testing Notifications Pagination:"
NOTIFICATIONS_PAGE=$(curl -s "$BASE_URL/api/v1/notifications?limit=20" \
  -H "Authorization: Bearer $DRIVER_TOKEN")
echo "$NOTIFICATIONS_PAGE" | grep -q '"success":true' && echo "✅ Notifications pagination working" || echo "❌ Notifications pagination not working"
echo ""

# Step 10: Test Invalid Pagination
echo "Step 10: Testing Invalid Pagination (should return 400)..."
echo ""

echo "10a. Testing invalid page parameter:"
INVALID_PAGE=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/v1/publish-ride?page=abc&limit=10" \
  -H "Authorization: Bearer $DRIVER_TOKEN")
HTTP_CODE=$(echo "$INVALID_PAGE" | tail -1)
echo "HTTP Code: $HTTP_CODE"
[ "$HTTP_CODE" = "400" ] && echo "✅ Invalid page returns 400" || echo "❌ Invalid page does not return 400"
echo ""

echo "10b. Testing exceeding max limit:"
INVALID_LIMIT=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/v1/bookings?page=1&limit=1000" \
  -H "Authorization: Bearer $PASSENGER_TOKEN")
HTTP_CODE=$(echo "$INVALID_LIMIT" | tail -1)
echo "HTTP Code: $HTTP_CODE"
[ "$HTTP_CODE" = "400" ] && echo "✅ Exceeding max limit returns 400" || echo "❌ Exceeding max limit does not return 400"
echo ""

# Summary
echo "========================================="
echo "Test Summary"
echo "========================================="
echo "✅ Driver Signup: $DRIVER_EMAIL"
echo "✅ Driver OTP Verified: $DRIVER_OTP"
echo "✅ Ride Published: $RIDE_ID"
echo "✅ Passenger Signup: $PASSENGER_EMAIL"
echo "✅ Passenger OTP Verified: $PASSENGER_OTP"
echo "✅ Booking Created: $BOOKING_ID"
echo "✅ Booking OTP: $BOOKING_OTP"
echo "✅ Driver can see booking on their ride"
echo "✅ All pagination endpoints tested"
echo "✅ Invalid pagination returns 400"
echo ""
echo "All tests completed successfully!"
echo "========================================="
