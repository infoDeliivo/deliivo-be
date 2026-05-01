#!/bin/bash

# Simple Stripe Payment Test
# This script demonstrates the payment flow with clear output

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_step() { echo -e "${BLUE}==>${NC} $1"; }
print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_info() { echo -e "${YELLOW}ℹ${NC} $1"; }

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║          Stripe Payment Test - Simple Version             ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

BASE_URL="http://localhost:3000/api/v1"

# Check server
print_step "Checking server..."
if curl -s "$BASE_URL/auth/signup" | grep -q "success\|error"; then
    print_success "Server is running"
else
    print_error "Server is not running"
    exit 1
fi

# Get token
print_step "Getting authentication token..."
echo ""
print_info "Please provide your access token:"
print_info "(Get it from Postman, or login via API)"
echo ""
read -p "Access Token: " TOKEN

if [ -z "$TOKEN" ]; then
    print_error "Token is required"
    exit 1
fi

# Verify token
print_step "Verifying token..."
USER_CHECK=$(curl -s -X GET "$BASE_URL/users/me" -H "Authorization: Bearer $TOKEN")

if echo "$USER_CHECK" | grep -q '"success":true'; then
    USER_ID=$(echo "$USER_CHECK" | jq -r '.data.id' 2>/dev/null || echo "unknown")
    print_success "Token verified! User ID: $USER_ID"
else
    print_error "Invalid token"
    echo "$USER_CHECK"
    exit 1
fi

# Get rides
print_step "Finding available rides..."
RIDES=$(curl -s -X GET "$BASE_URL/search-rides?page=1&limit=5" -H "Authorization: Bearer $TOKEN")

RIDE_COUNT=$(echo "$RIDES" | jq -r '.data.rides | length' 2>/dev/null || echo "0")

if [ "$RIDE_COUNT" -eq 0 ]; then
    print_error "No rides available"
    print_info "Please create a ride first"
    exit 1
fi

RIDE_ID=$(echo "$RIDES" | jq -r '.data.rides[0].id')
RIDE_PRICE=$(echo "$RIDES" | jq -r '.data.rides[0].basePricePerSeat')

print_success "Found ride: $RIDE_ID (£$RIDE_PRICE per seat)"

# Create booking
print_step "Creating booking with Stripe payment..."
BOOKING=$(curl -s -X POST "$BASE_URL/bookings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"rideId\": \"$RIDE_ID\", \"seatsBooked\": 2}")

if echo "$BOOKING" | grep -q '"success":true'; then
    BOOKING_ID=$(echo "$BOOKING" | jq -r '.data.booking.id')
    BOOKING_STATUS=$(echo "$BOOKING" | jq -r '.data.booking.status')
    TOTAL_PRICE=$(echo "$BOOKING" | jq -r '.data.booking.totalPrice')
    
    print_success "Booking created: $BOOKING_ID"
    print_info "Status: $BOOKING_STATUS"
    print_info "Total: £$TOTAL_PRICE"
    
    if echo "$BOOKING" | jq -e '.data.payment' > /dev/null 2>&1; then
        PAYMENT_INTENT=$(echo "$BOOKING" | jq -r '.data.payment.paymentIntentId')
        print_success "Payment Intent: $PAYMENT_INTENT"
        
        echo ""
        print_info "Next steps:"
        echo "  1. Go to Stripe Dashboard: https://dashboard.stripe.com/test/payments"
        echo "  2. Find Payment Intent: $PAYMENT_INTENT"
        echo "  3. Use test card to complete payment: 4242 4242 4242 4242"
        echo "  4. Check booking status after payment"
        echo ""
        print_info "Check booking status:"
        echo "  curl -X GET \"$BASE_URL/bookings/$BOOKING_ID\" \\"
        echo "    -H \"Authorization: Bearer $TOKEN\""
    else
        print_error "No payment object in response"
        print_info "Check if BOOKING_PAYMENT_MODE=stripe in .env"
    fi
else
    print_error "Failed to create booking"
    echo "$BOOKING" | jq
    exit 1
fi

echo ""
print_success "Test completed!"
echo ""
