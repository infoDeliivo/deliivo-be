#!/bin/bash

# Stripe Payment & Webhook Test Script
# This script tests the complete payment flow including webhook processing

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="http://localhost:3000/api/v1"
STRIPE_SECRET_KEY="sk_test_51TA5TI8tCboslOE27i0qYb8h4GYZYzR276wl5Db36KEsIiZ7yHpt4844nGMFGRPWcyxI9jzinXJRWdU3IO4QmQUl00dHNE23XH"

# Function to print colored output
print_step() {
    echo -e "${BLUE}==>${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_info() {
    echo -e "${YELLOW}ℹ${NC} $1"
}

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    print_error "jq is not installed. Please install it first:"
    echo "  macOS: brew install jq"
    echo "  Ubuntu: sudo apt-get install jq"
    exit 1
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║     Stripe Payment & Webhook Integration Test             ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Check if server is running
print_step "Step 1: Checking if server is running..."
if curl -s -f "$BASE_URL/auth/signup" > /dev/null 2>&1 || curl -s "$BASE_URL/auth/signup" | grep -q "success\|error"; then
    print_success "Server is running at $BASE_URL"
else
    print_error "Server is not running at $BASE_URL"
    print_info "Please start the server with: npm run dev"
    exit 1
fi

# Step 2: Get authentication token
print_step "Step 2: Getting authentication token..."
print_info "Please provide your access token:"
read -p "Access Token: " ACCESS_TOKEN

if [ -z "$ACCESS_TOKEN" ]; then
    print_error "Access token is required"
    exit 1
fi

# Verify token works
print_step "Verifying token..."
USER_RESPONSE=$(curl -s -X GET "$BASE_URL/users/me" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

if echo "$USER_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    USER_ID=$(echo "$USER_RESPONSE" | jq -r '.data.id')
    print_success "Token verified. User ID: $USER_ID"
else
    print_error "Invalid token or authentication failed"
    echo "$USER_RESPONSE" | jq
    exit 1
fi

# Step 3: Get or create a ride
print_step "Step 3: Getting available rides..."
RIDES_RESPONSE=$(curl -s -X GET "$BASE_URL/search-rides?page=1&limit=5" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

RIDE_COUNT=$(echo "$RIDES_RESPONSE" | jq -r '.data.rides | length')

if [ "$RIDE_COUNT" -eq 0 ]; then
    print_warning "No rides available. Please create a ride first."
    print_info "You can create a ride through the API or UI"
    exit 1
fi

# Get first available ride
RIDE_ID=$(echo "$RIDES_RESPONSE" | jq -r '.data.rides[0].id')
RIDE_PRICE=$(echo "$RIDES_RESPONSE" | jq -r '.data.rides[0].basePricePerSeat')
RIDE_ORIGIN=$(echo "$RIDES_RESPONSE" | jq -r '.data.rides[0].originAddress')
RIDE_DEST=$(echo "$RIDES_RESPONSE" | jq -r '.data.rides[0].destinationAddress')

print_success "Found ride: $RIDE_ID"
print_info "Route: $RIDE_ORIGIN → $RIDE_DEST"
print_info "Price per seat: £$RIDE_PRICE"

# Step 4: Create booking
print_step "Step 4: Creating booking with Stripe payment..."
BOOKING_RESPONSE=$(curl -s -X POST "$BASE_URL/bookings" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"rideId\": \"$RIDE_ID\",
    \"seatsBooked\": 2
  }")

# Check if booking was created successfully
if echo "$BOOKING_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    BOOKING_ID=$(echo "$BOOKING_RESPONSE" | jq -r '.data.booking.id')
    BOOKING_STATUS=$(echo "$BOOKING_RESPONSE" | jq -r '.data.booking.status')
    TOTAL_PRICE=$(echo "$BOOKING_RESPONSE" | jq -r '.data.booking.totalPrice')
    
    print_success "Booking created: $BOOKING_ID"
    print_info "Status: $BOOKING_STATUS"
    print_info "Total Price: £$TOTAL_PRICE"
    
    # Check if payment object exists
    if echo "$BOOKING_RESPONSE" | jq -e '.data.payment' > /dev/null 2>&1; then
        PAYMENT_INTENT_ID=$(echo "$BOOKING_RESPONSE" | jq -r '.data.payment.paymentIntentId')
        CLIENT_SECRET=$(echo "$BOOKING_RESPONSE" | jq -r '.data.payment.clientSecret')
        CURRENCY=$(echo "$BOOKING_RESPONSE" | jq -r '.data.payment.currency')
        
        print_success "Payment Intent created: $PAYMENT_INTENT_ID"
        print_info "Currency: $CURRENCY"
        print_info "Client Secret: ${CLIENT_SECRET:0:30}..."
    else
        print_error "Payment object not found in response"
        print_warning "Payment mode might be set to 'bypass'"
        echo "$BOOKING_RESPONSE" | jq
        exit 1
    fi
else
    print_error "Failed to create booking"
    echo "$BOOKING_RESPONSE" | jq
    exit 1
fi

# Step 5: Verify Payment Intent in Stripe
print_step "Step 5: Verifying Payment Intent in Stripe..."
STRIPE_PI_RESPONSE=$(curl -s -X GET "https://api.stripe.com/v1/payment_intents/$PAYMENT_INTENT_ID" \
  -u "$STRIPE_SECRET_KEY:")

if echo "$STRIPE_PI_RESPONSE" | jq -e '.id' > /dev/null 2>&1; then
    PI_STATUS=$(echo "$STRIPE_PI_RESPONSE" | jq -r '.status')
    PI_AMOUNT=$(echo "$STRIPE_PI_RESPONSE" | jq -r '.amount')
    PI_CURRENCY=$(echo "$STRIPE_PI_RESPONSE" | jq -r '.currency')
    
    print_success "Payment Intent found in Stripe"
    print_info "Status: $PI_STATUS"
    print_info "Amount: $PI_AMOUNT (minor units)"
    print_info "Currency: $PI_CURRENCY"
else
    print_error "Failed to retrieve Payment Intent from Stripe"
    echo "$STRIPE_PI_RESPONSE" | jq
fi

# Step 6: Simulate payment success (using Stripe API)
print_step "Step 6: Simulating payment confirmation..."
print_warning "In production, this would be done by the frontend using Stripe.js"
print_info "We'll use a test payment method to confirm the payment"

# Create a test payment method
PM_RESPONSE=$(curl -s -X POST "https://api.stripe.com/v1/payment_methods" \
  -u "$STRIPE_SECRET_KEY:" \
  -d "type=card" \
  -d "card[number]=4242424242424242" \
  -d "card[exp_month]=12" \
  -d "card[exp_year]=2034" \
  -d "card[cvc]=123")

PAYMENT_METHOD_ID=$(echo "$PM_RESPONSE" | jq -r '.id')

if [ "$PAYMENT_METHOD_ID" != "null" ]; then
    print_success "Test payment method created: $PAYMENT_METHOD_ID"
else
    print_error "Failed to create payment method"
    echo "$PM_RESPONSE" | jq
    exit 1
fi

# Confirm the payment intent
print_step "Confirming payment intent..."
CONFIRM_RESPONSE=$(curl -s -X POST "https://api.stripe.com/v1/payment_intents/$PAYMENT_INTENT_ID/confirm" \
  -u "$STRIPE_SECRET_KEY:" \
  -d "payment_method=$PAYMENT_METHOD_ID")

CONFIRM_STATUS=$(echo "$CONFIRM_RESPONSE" | jq -r '.status')

if [ "$CONFIRM_STATUS" == "succeeded" ]; then
    print_success "Payment confirmed successfully!"
    print_info "Payment Intent Status: $CONFIRM_STATUS"
else
    print_warning "Payment status: $CONFIRM_STATUS"
    if [ "$CONFIRM_STATUS" == "requires_action" ]; then
        print_info "Payment requires additional action (3D Secure)"
    fi
fi

# Step 7: Wait for webhook processing
print_step "Step 7: Waiting for webhook to process..."
print_info "Stripe will send payment_intent.succeeded webhook to your server"
print_warning "Make sure your webhook endpoint is accessible!"

for i in {1..10}; do
    echo -n "."
    sleep 1
done
echo ""

# Step 8: Check booking status after webhook
print_step "Step 8: Checking booking status after webhook..."
BOOKING_CHECK=$(curl -s -X GET "$BASE_URL/bookings/$BOOKING_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

UPDATED_STATUS=$(echo "$BOOKING_CHECK" | jq -r '.data.status')
PAYMENT_CAPTURED=$(echo "$BOOKING_CHECK" | jq -r '.data.paymentCapturedAt')

print_info "Current booking status: $UPDATED_STATUS"

if [ "$UPDATED_STATUS" == "DRIVER_PENDING" ]; then
    print_success "Webhook processed successfully!"
    print_success "Booking status updated to DRIVER_PENDING"
    print_info "Payment captured at: $PAYMENT_CAPTURED"
    print_info "Driver should receive notification now"
elif [ "$UPDATED_STATUS" == "PAYMENT_PENDING" ]; then
    print_warning "Booking still in PAYMENT_PENDING status"
    print_warning "Webhook might not have been processed yet"
    print_info "Possible reasons:"
    print_info "  1. Webhook endpoint not accessible"
    print_info "  2. Webhook secret mismatch"
    print_info "  3. Webhook processing error"
    print_info ""
    print_info "Check Stripe Dashboard → Webhooks for delivery status"
else
    print_info "Booking status: $UPDATED_STATUS"
fi

# Step 9: Check webhook events in database
print_step "Step 9: Checking webhook event logs..."
print_info "Check your database StripeWebhookEvent table for:"
print_info "  - stripeEventId"
print_info "  - eventType: payment_intent.succeeded"
print_info "  - paymentIntentId: $PAYMENT_INTENT_ID"

# Step 10: Summary
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    Test Summary                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Booking ID:          $BOOKING_ID"
echo "Payment Intent ID:   $PAYMENT_INTENT_ID"
echo "Initial Status:      PAYMENT_PENDING"
echo "Payment Status:      $CONFIRM_STATUS"
echo "Current Status:      $UPDATED_STATUS"
echo "Total Price:         £$TOTAL_PRICE"
echo ""

if [ "$UPDATED_STATUS" == "DRIVER_PENDING" ]; then
    echo -e "${GREEN}✓ Test PASSED${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Driver should receive notification"
    echo "  2. Driver can accept/reject booking"
    echo "  3. Check Stripe Dashboard for payment details"
else
    echo -e "${YELLOW}⚠ Test INCOMPLETE${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Check server logs for webhook errors"
    echo "  2. Verify webhook secret in .env"
    echo "  3. Check Stripe Dashboard → Webhooks → Recent events"
    echo "  4. Ensure webhook URL is accessible"
    echo ""
    echo "Stripe Dashboard Links:"
    echo "  Payments: https://dashboard.stripe.com/test/payments/$PAYMENT_INTENT_ID"
    echo "  Webhooks: https://dashboard.stripe.com/test/webhooks"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    Test Complete                           ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
