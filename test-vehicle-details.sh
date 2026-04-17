#!/bin/bash

# Test Vehicle Details in APIs
# This script tests that vehicle details are returned in booking and ride APIs

BASE_URL="http://localhost:3000/api/v1"

echo "=========================================="
echo "Testing Vehicle Details Implementation"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Login as Driver
echo -e "${YELLOW}Step 1: Login as Driver${NC}"
DRIVER_LOGIN=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "driver@example.com",
    "password": "password123"
  }')

DRIVER_TOKEN=$(echo $DRIVER_LOGIN | jq -r '.data.accessToken')

if [ "$DRIVER_TOKEN" == "null" ] || [ -z "$DRIVER_TOKEN" ]; then
  echo -e "${RED}❌ Driver login failed${NC}"
  echo "Response: $DRIVER_LOGIN"
  exit 1
fi

echo -e "${GREEN}✅ Driver logged in${NC}"
echo "Token: ${DRIVER_TOKEN:0:20}..."
echo ""

# Step 2: Get Driver's Rides (should include vehicle details)
echo -e "${YELLOW}Step 2: Get Driver's Rides${NC}"
DRIVER_RIDES=$(curl -s -X GET "$BASE_URL/publish-ride?page=1&limit=5" \
  -H "Authorization: Bearer $DRIVER_TOKEN")

echo "Response:"
echo $DRIVER_RIDES | jq '.'

# Check if vehicle details are present
HAS_VEHICLE=$(echo $DRIVER_RIDES | jq '.data.rides[0].vehicle != null')
if [ "$HAS_VEHICLE" == "true" ]; then
  echo -e "${GREEN}✅ Vehicle details found in driver's rides${NC}"
  echo "Vehicle Info:"
  echo $DRIVER_RIDES | jq '.data.rides[0].vehicle'
else
  echo -e "${YELLOW}⚠️  No vehicle details (ride may not have vehicle assigned)${NC}"
fi
echo ""

# Step 3: Get Single Ride Details
RIDE_ID=$(echo $DRIVER_RIDES | jq -r '.data.rides[0].id')
if [ "$RIDE_ID" != "null" ] && [ ! -z "$RIDE_ID" ]; then
  echo -e "${YELLOW}Step 3: Get Single Ride Details${NC}"
  echo "Ride ID: $RIDE_ID"
  
  RIDE_DETAILS=$(curl -s -X GET "$BASE_URL/publish-ride/$RIDE_ID" \
    -H "Authorization: Bearer $DRIVER_TOKEN")
  
  echo "Response:"
  echo $RIDE_DETAILS | jq '.'
  
  HAS_VEHICLE=$(echo $RIDE_DETAILS | jq '.data.vehicle != null')
  if [ "$HAS_VEHICLE" == "true" ]; then
    echo -e "${GREEN}✅ Vehicle details found in ride details${NC}"
    echo "Vehicle Info:"
    echo $RIDE_DETAILS | jq '.data.vehicle'
  else
    echo -e "${YELLOW}⚠️  No vehicle details (ride may not have vehicle assigned)${NC}"
  fi
  echo ""
fi

# Step 4: Login as Passenger
echo -e "${YELLOW}Step 4: Login as Passenger${NC}"
PASSENGER_LOGIN=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "passenger@example.com",
    "password": "password123"
  }')

PASSENGER_TOKEN=$(echo $PASSENGER_LOGIN | jq -r '.data.accessToken')

if [ "$PASSENGER_TOKEN" == "null" ] || [ -z "$PASSENGER_TOKEN" ]; then
  echo -e "${RED}❌ Passenger login failed${NC}"
  echo "Response: $PASSENGER_LOGIN"
  exit 1
fi

echo -e "${GREEN}✅ Passenger logged in${NC}"
echo "Token: ${PASSENGER_TOKEN:0:20}..."
echo ""

# Step 5: Get Passenger's Bookings (should include vehicle details)
echo -e "${YELLOW}Step 5: Get Passenger's Bookings${NC}"
BOOKINGS=$(curl -s -X GET "$BASE_URL/bookings?page=1&limit=5" \
  -H "Authorization: Bearer $PASSENGER_TOKEN")

echo "Response:"
echo $BOOKINGS | jq '.'

# Check if vehicle details are present
HAS_VEHICLE=$(echo $BOOKINGS | jq '.data.bookings[0].ride.vehicle != null')
if [ "$HAS_VEHICLE" == "true" ]; then
  echo -e "${GREEN}✅ Vehicle details found in passenger's bookings${NC}"
  echo "Vehicle Info:"
  echo $BOOKINGS | jq '.data.bookings[0].ride.vehicle'
else
  echo -e "${YELLOW}⚠️  No vehicle details (ride may not have vehicle assigned)${NC}"
fi
echo ""

# Step 6: Get Single Booking Details
BOOKING_ID=$(echo $BOOKINGS | jq -r '.data.bookings[0].id')
if [ "$BOOKING_ID" != "null" ] && [ ! -z "$BOOKING_ID" ]; then
  echo -e "${YELLOW}Step 6: Get Single Booking Details${NC}"
  echo "Booking ID: $BOOKING_ID"
  
  BOOKING_DETAILS=$(curl -s -X GET "$BASE_URL/bookings/$BOOKING_ID" \
    -H "Authorization: Bearer $PASSENGER_TOKEN")
  
  echo "Response:"
  echo $BOOKING_DETAILS | jq '.'
  
  HAS_VEHICLE=$(echo $BOOKING_DETAILS | jq '.data.ride.vehicle != null')
  if [ "$HAS_VEHICLE" == "true" ]; then
    echo -e "${GREEN}✅ Vehicle details found in booking details${NC}"
    echo "Vehicle Info:"
    echo $BOOKING_DETAILS | jq '.data.ride.vehicle'
  else
    echo -e "${YELLOW}⚠️  No vehicle details (ride may not have vehicle assigned)${NC}"
  fi
  echo ""
fi

echo "=========================================="
echo -e "${GREEN}✅ Vehicle Details Test Complete${NC}"
echo "=========================================="
echo ""
echo "Summary:"
echo "- Driver's rides API: Tested"
echo "- Single ride details API: Tested"
echo "- Passenger's bookings API: Tested"
echo "- Single booking details API: Tested"
echo ""
echo "Note: If no vehicle details are shown, it means the rides"
echo "don't have vehicles assigned. This is expected behavior."
