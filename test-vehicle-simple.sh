#!/bin/bash

# Simple test to check vehicle details in APIs

BASE_URL="http://localhost:3000/api/v1"

echo "Testing Vehicle Details Implementation"
echo "======================================"
echo ""

# Test with production URL if provided
if [ ! -z "$1" ]; then
  BASE_URL="$1/api/v1"
  echo "Using production URL: $BASE_URL"
  echo ""
fi

# Try to login with test credentials
echo "1. Testing Driver Login..."
DRIVER_LOGIN=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123456"
  }')

echo "Login Response:"
echo $DRIVER_LOGIN | jq '.' 2>/dev/null || echo $DRIVER_LOGIN
echo ""

DRIVER_TOKEN=$(echo $DRIVER_LOGIN | jq -r '.data.accessToken' 2>/dev/null)

if [ "$DRIVER_TOKEN" != "null" ] && [ ! -z "$DRIVER_TOKEN" ]; then
  echo "✅ Login successful"
  echo ""
  
  # Get driver's rides
  echo "2. Testing GET /publish-ride (Driver's Rides)"
  RIDES=$(curl -s -X GET "$BASE_URL/publish-ride?page=1&limit=5" \
    -H "Authorization: Bearer $DRIVER_TOKEN")
  
  echo "Response:"
  echo $RIDES | jq '.' 2>/dev/null || echo $RIDES
  echo ""
  
  # Check for vehicle field
  HAS_VEHICLE_FIELD=$(echo $RIDES | jq 'has("data") and .data.rides[0] | has("vehicle")' 2>/dev/null)
  if [ "$HAS_VEHICLE_FIELD" == "true" ]; then
    echo "✅ Vehicle field exists in response"
    VEHICLE_DATA=$(echo $RIDES | jq '.data.rides[0].vehicle' 2>/dev/null)
    if [ "$VEHICLE_DATA" != "null" ]; then
      echo "✅ Vehicle data found:"
      echo $VEHICLE_DATA | jq '.'
    else
      echo "⚠️  Vehicle field is null (ride has no vehicle assigned)"
    fi
  else
    echo "❌ Vehicle field not found in response"
  fi
  echo ""
  
  # Get single ride details
  RIDE_ID=$(echo $RIDES | jq -r '.data.rides[0].id' 2>/dev/null)
  if [ "$RIDE_ID" != "null" ] && [ ! -z "$RIDE_ID" ]; then
    echo "3. Testing GET /publish-ride/:id (Single Ride)"
    echo "Ride ID: $RIDE_ID"
    
    RIDE_DETAIL=$(curl -s -X GET "$BASE_URL/publish-ride/$RIDE_ID" \
      -H "Authorization: Bearer $DRIVER_TOKEN")
    
    echo "Response:"
    echo $RIDE_DETAIL | jq '.' 2>/dev/null || echo $RIDE_DETAIL
    echo ""
    
    HAS_VEHICLE_FIELD=$(echo $RIDE_DETAIL | jq 'has("data") and .data | has("vehicle")' 2>/dev/null)
    if [ "$HAS_VEHICLE_FIELD" == "true" ]; then
      echo "✅ Vehicle field exists in response"
      VEHICLE_DATA=$(echo $RIDE_DETAIL | jq '.data.vehicle' 2>/dev/null)
      if [ "$VEHICLE_DATA" != "null" ]; then
        echo "✅ Vehicle data found:"
        echo $VEHICLE_DATA | jq '.'
      else
        echo "⚠️  Vehicle field is null (ride has no vehicle assigned)"
      fi
    else
      echo "❌ Vehicle field not found in response"
    fi
  fi
else
  echo "❌ Login failed - cannot test further"
  echo "Please create a test user or update credentials"
fi

echo ""
echo "======================================"
echo "Test Complete"
echo "======================================"
