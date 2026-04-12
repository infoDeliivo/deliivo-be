#!/bin/bash

# Production API Test - Check OTP in Booking Response
PROD_URL="https://practical-communication-production-18f8.up.railway.app"
TIMESTAMP=$(date +%s)
TEST_EMAIL="prodtest${TIMESTAMP}@test.com"

echo "========================================="
echo "Production API Test - OTP in Booking"
echo "========================================="
echo "Production URL: $PROD_URL"
echo ""

# Step 1: Signup
echo "Step 1: Creating test user..."
SIGNUP_RESPONSE=$(curl -s -X POST "$PROD_URL/api/v1/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{
    \"method\": \"email\",
    \"email\": \"$TEST_EMAIL\",
    \"name\": \"Production Test User\"
  }")

echo "Signup Response:"
echo "$SIGNUP_RESPONSE" | jq '.' 2>/dev/null || echo "$SIGNUP_RESPONSE"
echo ""

OTP=$(echo $SIGNUP_RESPONSE | grep -o '"code":"[^"]*"' | cut -d'"' -f4)
if [ -z "$OTP" ]; then
    echo "❌ Failed to get OTP from signup response"
    exit 1
fi
echo "✅ OTP received: $OTP"
echo ""

# Step 2: Verify OTP
echo "Step 2: Verifying OTP..."
VERIFY_RESPONSE=$(curl -s -X POST "$PROD_URL/api/v1/auth/otp/verify" \
  -H "Content-Type: application/json" \
  -d "{
    \"method\": \"email\",
    \"identifier\": \"$TEST_EMAIL\",
    \"code\": \"$OTP\",
    \"purpose\": \"signup\"
  }")

echo "Verify Response:"
echo "$VERIFY_RESPONSE" | jq '.' 2>/dev/null || echo "$VERIFY_RESPONSE"
echo ""

TOKEN=$(echo $VERIFY_RESPONSE | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
if [ -z "$TOKEN" ]; then
    echo "❌ Failed to get access token"
    exit 1
fi
echo "✅ Access token received: ${TOKEN:0:50}..."
echo ""

# Step 3: Check if there are any published rides
echo "Step 3: Searching for available rides..."
SEARCH_RESPONSE=$(curl -s "$PROD_URL/api/v1/search-rides?originLat=51.5074&originLng=-0.1278&destinationLat=53.4808&destinationLng=-2.2426&departureDate=2026-04-20&page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN")

echo "Search Response:"
echo "$SEARCH_RESPONSE" | jq '.data.rides | length' 2>/dev/null || echo "$SEARCH_RESPONSE"
echo ""

RIDE_COUNT=$(echo "$SEARCH_RESPONSE" | jq -r '.data.rides | length' 2>/dev/null || echo "0")
echo "Available rides: $RIDE_COUNT"
echo ""

if [ "$RIDE_COUNT" -gt 0 ]; then
    RIDE_ID=$(echo "$SEARCH_RESPONSE" | jq -r '.data.rides[0].id' 2>/dev/null)
    echo "✅ Found ride: $RIDE_ID"
    echo ""
    
    # Step 4: Create booking
    echo "Step 4: Creating booking..."
    BOOKING_RESPONSE=$(curl -s -X POST "$PROD_URL/api/v1/bookings" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{
        \"rideId\": \"$RIDE_ID\",
        \"seatsBooked\": 1,
        \"luggageCount\": 0,
        \"notes\": \"Production test booking\"
      }")
    
    echo "Booking Response:"
    echo "$BOOKING_RESPONSE" | jq '.' 2>/dev/null || echo "$BOOKING_RESPONSE"
    echo ""
    
    # Check for OTP in response
    echo "========================================="
    echo "Checking for OTP in Booking Response"
    echo "========================================="
    
    BOOKING_ID=$(echo "$BOOKING_RESPONSE" | jq -r '.data.id' 2>/dev/null)
    BOOKING_STATUS=$(echo "$BOOKING_RESPONSE" | jq -r '.data.status' 2>/dev/null)
    PICKUP_OTP=$(echo "$BOOKING_RESPONSE" | jq -r '.data.pickupOtp' 2>/dev/null)
    DROP_OTP=$(echo "$BOOKING_RESPONSE" | jq -r '.data.dropOtp' 2>/dev/null)
    
    echo "Booking ID: $BOOKING_ID"
    echo "Booking Status: $BOOKING_STATUS"
    echo "Pickup OTP: $PICKUP_OTP"
    echo "Drop OTP: $DROP_OTP"
    echo ""
    
    if [ "$PICKUP_OTP" != "null" ] && [ -n "$PICKUP_OTP" ]; then
        echo "✅ Pickup OTP is present in response: $PICKUP_OTP"
    else
        echo "❌ Pickup OTP is NOT present in response"
        echo "   (This is expected if booking status is PAYMENT_PENDING or DRIVER_PENDING)"
    fi
    
    if [ "$DROP_OTP" != "null" ] && [ -n "$DROP_OTP" ]; then
        echo "✅ Drop OTP is present in response: $DROP_OTP"
    else
        echo "❌ Drop OTP is NOT present in response"
        echo "   (This is expected if booking status is PAYMENT_PENDING or DRIVER_PENDING)"
    fi
    echo ""
    
    # Step 5: Get booking details
    if [ -n "$BOOKING_ID" ] && [ "$BOOKING_ID" != "null" ]; then
        echo "Step 5: Getting booking details..."
        BOOKING_DETAILS=$(curl -s "$PROD_URL/api/v1/bookings/$BOOKING_ID" \
          -H "Authorization: Bearer $TOKEN")
        
        echo "Booking Details Response:"
        echo "$BOOKING_DETAILS" | jq '.' 2>/dev/null || echo "$BOOKING_DETAILS"
        echo ""
        
        DETAIL_PICKUP_OTP=$(echo "$BOOKING_DETAILS" | jq -r '.data.pickupOtp' 2>/dev/null)
        DETAIL_DROP_OTP=$(echo "$BOOKING_DETAILS" | jq -r '.data.dropOtp' 2>/dev/null)
        DETAIL_STATUS=$(echo "$BOOKING_DETAILS" | jq -r '.data.status' 2>/dev/null)
        
        echo "========================================="
        echo "Booking Details OTP Check"
        echo "========================================="
        echo "Status: $DETAIL_STATUS"
        echo "Pickup OTP: $DETAIL_PICKUP_OTP"
        echo "Drop OTP: $DETAIL_DROP_OTP"
        echo ""
        
        if [ "$DETAIL_PICKUP_OTP" != "null" ] && [ -n "$DETAIL_PICKUP_OTP" ]; then
            echo "✅ Pickup OTP is present in booking details: $DETAIL_PICKUP_OTP"
        else
            echo "❌ Pickup OTP is NOT present in booking details"
        fi
        
        if [ "$DETAIL_DROP_OTP" != "null" ] && [ -n "$DETAIL_DROP_OTP" ]; then
            echo "✅ Drop OTP is present in booking details: $DETAIL_DROP_OTP"
        else
            echo "❌ Drop OTP is NOT present in booking details"
        fi
    fi
else
    echo "⚠️  No rides available for testing"
    echo "   You need to publish a ride first to test booking OTP"
fi

echo ""
echo "========================================="
echo "Summary"
echo "========================================="
echo "Production URL: $PROD_URL"
echo "Test Email: $TEST_EMAIL"
echo "Test OTP: $OTP"
echo ""
echo "OTP Availability:"
echo "  - OTPs are generated when driver ACCEPTS the booking"
echo "  - Status must be CONFIRMED, IN_PROGRESS, or COMPLETED"
echo "  - PAYMENT_PENDING and DRIVER_PENDING do not have OTPs"
echo ""
echo "To see OTPs in response:"
echo "  1. Create a booking (status: PAYMENT_PENDING)"
echo "  2. Complete payment (status: DRIVER_PENDING)"
echo "  3. Driver accepts booking (status: CONFIRMED) ← OTPs generated here"
echo "  4. Check booking details to see pickupOtp and dropOtp"
echo "========================================="
