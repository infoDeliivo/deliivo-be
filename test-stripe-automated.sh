#!/bin/bash

# Fully Automated Stripe Payment Test
# This script creates a test user, gets token, and runs the complete test

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
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_info() { echo -e "${YELLOW}ℹ${NC} $1"; }

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║     Stripe Payment Test - Fully Automated Version         ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

BASE_URL="http://localhost:3000/api/v1"
STRIPE_SECRET_KEY="sk_test_51TA5TI8tCboslOE27i0qYb8h4GYZYzR276wl5Db36KEsIiZ7yHpt4844nGMFGRPWcyxI9jzinXJRWdU3IO4QmQUl00dHNE23XH"

# Test user credentials
TEST_EMAIL="stripetest@example.com"
TEST_PHONE="+15555551234"
TEST_NAME="Stripe Test User"

# Check jq
if ! command -v jq &> /dev/null; then
    print_error "jq is not installed"
    exit 1
fi

# Check server
print_step "Step 1: Checking server..."
if curl -s -X POST "$BASE_URL/auth/signup" -H "Content-Type: application/json" -d "{}" | grep -q "success\|error"; then
    print_success "Server is running"
else
    print_error "Server is not running"
    exit 1
fi

# Create or login test user
print_step "Step 2: Setting up test user..."

# Try to signup
SIGNUP_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{
    \"method\": \"email\",
    \"identifier\": \"$TEST_EMAIL\",
    \"name\": \"$TEST_NAME\",
    \"password\": \"Test123!@#\"
  }")

if echo "$SIGNUP_RESPONSE" | grep -q '"success":true'; then
    print_info "Signup initiated, OTP sent"
    
    # Check if OTP is exposed in response (dev mode)
    if echo "$SIGNUP_RESPONSE" | jq -e '.otp' > /dev/null 2>&1; then
        OTP=$(echo "$SIGNUP_RESPONSE" | jq -r '.otp')
        print_info "OTP from response: $OTP"
    else
        print_warning "OTP not in response. Checking environment..."
        if [ "$EXPOSE_OTP_IN_RESPONSE" = "true" ] || [ "$NODE_ENV" != "production" ]; then
            print_info "Waiting 2 seconds for OTP generation..."
            sleep 2
            # Try to get OTP from logs or use a default test OTP
            OTP="123456"
            print_info "Using test OTP: $OTP"
        else
            print_error "Cannot get OTP automatically"
            print_info "Please check your email for OTP and run the interactive test:"
            echo "  ./test-stripe-payment.sh"
            exit 1
        fi
    fi
    
    # Verify OTP
    print_step "Verifying OTP..."
    VERIFY_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/verify-otp" \
      -H "Content-Type: application/json" \
      -d "{
        \"method\": \"email\",
        \"identifier\": \"$TEST_EMAIL\",
        \"otp\": \"$OTP\"
      }")
    
    if echo "$VERIFY_RESPONSE" | grep -q '"success":true'; then
        TOKEN=$(echo "$VERIFY_RESPONSE" | jq -r '.data.accessToken')
        print_success "User created and verified"
    else
        print_error "OTP verification failed"
        echo "$VERIFY_RESPONSE" | jq
        
        # Try login instead
        print_info "Trying to login with existing user..."
        LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
          -H "Content-Type: application/json" \
          -d "{
            \"method\": \"email\",
            \"identifier\": \"$TEST_EMAIL\"
          }")
        
        print_error "Automated test requires OTP. Please run interactive test:"
        echo "  ./test-stripe-payment.sh"
        exit 1
    fi
else
    # User might already exist, try login
    print_info "User might exist, trying login..."
    LOGIN_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/login" \
      -H "Content-Type: application/json" \
      -d "{
        \"method\": \"email\",
        \"identifier\": \"$TEST_EMAIL\"
      }")
    
    if echo "$LOGIN_RESPONSE" | grep -q '"success":true'; then
        print_info "Login OTP sent"
        
        # Check if OTP is exposed
        if echo "$LOGIN_RESPONSE" | jq -e '.otp' > /dev/null 2>&1; then
            OTP=$(echo "$LOGIN_RESPONSE" | jq -r '.otp')
            print_info "OTP from response: $OTP"
            
            # Verify OTP
            VERIFY_RESPONSE=$(curl -s -X POST "$BASE_URL/auth/verify-otp" \
              -H "Content-Type: application/json" \
              -d "{
                \"method\": \"email\",
                \"identifier\": \"$TEST_EMAIL\",
                \"otp\": \"$OTP\"
              }")
            
            if echo "$VERIFY_RESPONSE" | grep -q '"success":true'; then
                TOKEN=$(echo "$VERIFY_RESPONSE" | jq -r '.data.accessToken')
                print_success "Logged in successfully"
            else
                print_error "OTP verification failed"
                exit 1
            fi
        else
            print_error "Cannot get OTP automatically"
            print_info "Please run the interactive test instead:"
            echo "  ./test-stripe-payment.sh"
            exit 1
        fi
    else
        print_error "Login failed"
        echo "$LOGIN_RESPONSE" | jq
        exit 1
    fi
fi

if [ -z "$TOKEN" ]; then
    print_error "Failed to get access token"
    exit 1
fi

print_success "Access token obtained"

# Verify token
print_step "Step 3: Verifying token..."
USER_RESPONSE=$(curl -s -X GET "$BASE_URL/users/me" \
  -H "Authorization: Bearer $TOKEN")

if echo "$USER_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    USER_ID=$(echo "$USER_RESPONSE" | jq -r '.data.id')
    print_success "Token verified. User ID: $USER_ID"
else
    print_error "Token verification failed"
    exit 1
fi

# Get rides
print_step "Step 4: Finding available rides..."
RIDES_RESPONSE=$(curl -s -X GET "$BASE_URL/search-rides?page=1&limit=5" \
  -H "Authorization: Bearer $TOKEN")

RIDE_COUNT=$(echo "$RIDES_RESPONSE" | jq -r '.data.rides | length')

if [ "$RIDE_COUNT" -eq 0 ]; then
    print_warning "No rides available"
    print_info "Creating a test ride..."
    
    # Note: This would require a vehicle. For now, just inform the user
    print_error "Please create a ride first via API or UI"
    print_info "Then run this test again"
    exit 1
fi

RIDE_ID=$(echo "$RIDES_RESPONSE" | jq -r '.data.rides[0].id')
RIDE_PRICE=$(echo "$RIDES_RESPONSE" | jq -r '.data.rides[0].basePricePerSeat')
RIDE_ORIGIN=$(echo "$RIDES_RESPONSE" | jq -r '.data.rides[0].originAddress')
RIDE_DEST=$(echo "$RIDES_RESPONSE" | jq -r '.data.rides[0].destinationAddress')

print_success "Found ride: $RIDE_ID"
print_info "Route: $RIDE_ORIGIN → $RIDE_DEST"
print_info "Price per seat: £$RIDE_PRICE"

# Create booking
print_step "Step 5: Creating booking with Stripe payment..."
BOOKING_RESPONSE=$(curl -s -X POST "$BASE_URL/bookings" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"rideId\": \"$RIDE_ID\",
    \"seatsBooked\": 2
  }")

if echo "$BOOKING_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    BOOKING_ID=$(echo "$BOOKING_RESPONSE" | jq -r '.data.booking.id')
    BOOKING_STATUS=$(echo "$BOOKING_RESPONSE" | jq -r '.data.booking.status')
    TOTAL_PRICE=$(echo "$BOOKING_RESPONSE" | jq -r '.data.booking.totalPrice')
    
    print_success "Booking created: $BOOKING_ID"
    print_info "Status: $BOOKING_STATUS"
    print_info "Total Price: £$TOTAL_PRICE"
    
    if echo "$BOOKING_RESPONSE" | jq -e '.data.payment' > /dev/null 2>&1; then
        PAYMENT_INTENT_ID=$(echo "$BOOKING_RESPONSE" | jq -r '.data.payment.paymentIntentId')
        CLIENT_SECRET=$(echo "$BOOKING_RESPONSE" | jq -r '.data.payment.clientSecret')
        CURRENCY=$(echo "$BOOKING_RESPONSE" | jq -r '.data.payment.currency')
        
        print_success "Payment Intent created: $PAYMENT_INTENT_ID"
        print_info "Currency: $CURRENCY"
    else
        print_error "Payment object not found"
        print_warning "Check BOOKING_PAYMENT_MODE in .env"
        exit 1
    fi
else
    print_error "Failed to create booking"
    echo "$BOOKING_RESPONSE" | jq
    exit 1
fi

# Verify Payment Intent in Stripe
print_step "Step 6: Verifying Payment Intent in Stripe..."
STRIPE_PI_RESPONSE=$(curl -s -X GET "https://api.stripe.com/v1/payment_intents/$PAYMENT_INTENT_ID" \
  -u "$STRIPE_SECRET_KEY:")

if echo "$STRIPE_PI_RESPONSE" | jq -e '.id' > /dev/null 2>&1; then
    PI_STATUS=$(echo "$STRIPE_PI_RESPONSE" | jq -r '.status')
    PI_AMOUNT=$(echo "$STRIPE_PI_RESPONSE" | jq -r '.amount')
    
    print_success "Payment Intent found in Stripe"
    print_info "Status: $PI_STATUS"
    print_info "Amount: $PI_AMOUNT (minor units)"
else
    print_error "Failed to retrieve Payment Intent"
    exit 1
fi

# Simulate payment
print_step "Step 7: Simulating payment confirmation..."
PM_RESPONSE=$(curl -s -X POST "https://api.stripe.com/v1/payment_methods" \
  -u "$STRIPE_SECRET_KEY:" \
  -d "type=card" \
  -d "card[number]=4242424242424242" \
  -d "card[exp_month]=12" \
  -d "card[exp_year]=2034" \
  -d "card[cvc]=123")

PAYMENT_METHOD_ID=$(echo "$PM_RESPONSE" | jq -r '.id')

if [ "$PAYMENT_METHOD_ID" != "null" ]; then
    print_success "Test payment method created"
else
    print_error "Failed to create payment method"
    exit 1
fi

# Confirm payment
print_step "Step 8: Confirming payment intent..."
CONFIRM_RESPONSE=$(curl -s -X POST "https://api.stripe.com/v1/payment_intents/$PAYMENT_INTENT_ID/confirm" \
  -u "$STRIPE_SECRET_KEY:" \
  -d "payment_method=$PAYMENT_METHOD_ID")

CONFIRM_STATUS=$(echo "$CONFIRM_RESPONSE" | jq -r '.status')

if [ "$CONFIRM_STATUS" == "succeeded" ]; then
    print_success "Payment confirmed successfully!"
else
    print_warning "Payment status: $CONFIRM_STATUS"
fi

# Wait for webhook
print_step "Step 9: Waiting for webhook processing..."
for i in {1..10}; do
    echo -n "."
    sleep 1
done
echo ""

# Check booking status
print_step "Step 10: Checking booking status..."
BOOKING_CHECK=$(curl -s -X GET "$BASE_URL/bookings/$BOOKING_ID" \
  -H "Authorization: Bearer $TOKEN")

UPDATED_STATUS=$(echo "$BOOKING_CHECK" | jq -r '.data.status')

print_info "Current booking status: $UPDATED_STATUS"

# Summary
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    Test Summary                            ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Booking ID:          $BOOKING_ID"
echo "Payment Intent ID:   $PAYMENT_INTENT_ID"
echo "Payment Status:      $CONFIRM_STATUS"
echo "Booking Status:      $UPDATED_STATUS"
echo "Total Price:         £$TOTAL_PRICE"
echo ""

if [ "$UPDATED_STATUS" == "DRIVER_PENDING" ]; then
    echo -e "${GREEN}✓ Test PASSED${NC}"
    echo ""
    print_info "Webhook processed successfully!"
    print_info "Driver should receive notification"
else
    echo -e "${YELLOW}⚠ Test INCOMPLETE${NC}"
    echo ""
    print_warning "Booking status is $UPDATED_STATUS (expected: DRIVER_PENDING)"
    print_info "Webhook might not have been processed"
    print_info ""
    print_info "To fix webhook issues:"
    echo "  1. Run: ./setup-stripe-webhook.sh"
    echo "  2. Update STRIPE_WEBHOOK_SECRET in .env"
    echo "  3. Restart server: npm run dev"
    echo "  4. Run test again"
fi

echo ""
print_info "Stripe Dashboard: https://dashboard.stripe.com/test/payments/$PAYMENT_INTENT_ID"
echo ""
