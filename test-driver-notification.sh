#!/bin/bash

# Test script to verify driver notification after payment
# This script helps diagnose WebSocket notification issues

echo "🧪 Driver Notification Test Script"
echo "===================================="
echo ""

# Check if required environment variables are set
if [ -z "$DRIVER_USER_ID" ]; then
    echo "❌ Error: DRIVER_USER_ID environment variable not set"
    echo "   Usage: DRIVER_USER_ID=<driver-id> BOOKING_ID=<booking-id> ./test-driver-notification.sh"
    exit 1
fi

if [ -z "$BOOKING_ID" ]; then
    echo "❌ Error: BOOKING_ID environment variable not set"
    echo "   Usage: DRIVER_USER_ID=<driver-id> BOOKING_ID=<booking-id> ./test-driver-notification.sh"
    exit 1
fi

echo "📋 Test Configuration:"
echo "   Driver User ID: $DRIVER_USER_ID"
echo "   Booking ID: $BOOKING_ID"
echo ""

# Step 1: Check if driver exists
echo "1️⃣ Checking if driver exists..."
DRIVER_CHECK=$(psql $DATABASE_URL -t -c "SELECT id, name FROM \"User\" WHERE id = '$DRIVER_USER_ID' LIMIT 1;")
if [ -z "$DRIVER_CHECK" ]; then
    echo "   ❌ Driver not found in database"
    exit 1
else
    echo "   ✅ Driver found: $DRIVER_CHECK"
fi
echo ""

# Step 2: Check booking status
echo "2️⃣ Checking booking status..."
BOOKING_STATUS=$(psql $DATABASE_URL -t -c "SELECT id, status, \"passengerId\", \"rideId\" FROM \"RideBooking\" WHERE id = '$BOOKING_ID' LIMIT 1;")
if [ -z "$BOOKING_STATUS" ]; then
    echo "   ❌ Booking not found"
    exit 1
else
    echo "   ✅ Booking found: $BOOKING_STATUS"
fi
echo ""

# Step 3: Check if driver has any notifications
echo "3️⃣ Checking driver notifications..."
NOTIFICATION_COUNT=$(psql $DATABASE_URL -t -c "SELECT COUNT(*) FROM \"Notification\" WHERE \"userId\" = '$DRIVER_USER_ID';")
echo "   📬 Driver has $NOTIFICATION_COUNT total notification(s)"

RECENT_NOTIFICATIONS=$(psql $DATABASE_URL -t -c "SELECT id, type, title, \"createdAt\" FROM \"Notification\" WHERE \"userId\" = '$DRIVER_USER_ID' ORDER BY \"createdAt\" DESC LIMIT 5;")
echo "   Recent notifications:"
echo "$RECENT_NOTIFICATIONS"
echo ""

# Step 4: Check Redis for driver presence
echo "4️⃣ Checking driver WebSocket connection status..."
if command -v redis-cli &> /dev/null; then
    REDIS_HOST=${REDIS_HOST:-localhost}
    REDIS_PORT=${REDIS_PORT:-6379}
    
    PRESENCE=$(redis-cli -h $REDIS_HOST -p $REDIS_PORT GET "presence:$DRIVER_USER_ID" 2>/dev/null)
    if [ -z "$PRESENCE" ]; then
        echo "   📴 Driver is OFFLINE (no WebSocket connection)"
        echo "   ⚠️  This is likely why notification wasn't delivered via WebSocket"
    else
        echo "   ✅ Driver is ONLINE: $PRESENCE"
    fi
else
    echo "   ⚠️  redis-cli not available, skipping presence check"
fi
echo ""

# Step 5: Check application logs
echo "5️⃣ Checking recent application logs..."
if [ -f "logs/combined.log" ]; then
    echo "   Last 20 lines mentioning driver or notification:"
    tail -100 logs/combined.log | grep -i "driver\|notification\|socket" | tail -20
else
    echo "   ⚠️  logs/combined.log not found"
fi
echo ""

# Step 6: Recommendations
echo "🔍 Diagnostic Summary:"
echo "====================="
echo ""
echo "If driver didn't receive notification, check:"
echo "1. Is driver connected via WebSocket? (Check step 4)"
echo "2. Was notification created in database? (Check step 3)"
echo "3. Check application logs for errors (Check step 5)"
echo "4. Verify driver's mobile app is listening to 'notification:new' event"
echo "5. Check if Socket.IO server is running (look for '✅ Socket.IO server initialized' in logs)"
echo ""
echo "To manually test WebSocket notification:"
echo "  1. Connect driver's app to WebSocket with valid JWT token"
echo "  2. Listen for 'notification:new' event"
echo "  3. Trigger a payment success webhook"
echo "  4. Check if notification is received"
echo ""
