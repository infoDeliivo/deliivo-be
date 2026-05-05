#!/bin/bash

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🧪 Testing Stripe Webhook with Real Payment${NC}\n"

# Get the booking ID from the last test
BOOKING_ID="4691b5e3-2119-425f-a53a-e38f6a45db45"
PAYMENT_INTENT_ID="pi_3TT71L8tCboslOE20TjkZStw"

echo -e "${YELLOW}📋 Test Details:${NC}"
echo "Booking ID: $BOOKING_ID"
echo "Payment Intent: $PAYMENT_INTENT_ID"
echo ""

echo -e "${YELLOW}Step 1: Check current booking status${NC}"
echo "Run this SQL query:"
echo -e "${GREEN}SELECT id, status, \"paymentCapturedAt\" FROM \"RideBooking\" WHERE id = '$BOOKING_ID';${NC}"
echo ""

echo -e "${YELLOW}Step 2: Complete payment in Stripe Dashboard${NC}"
echo "1. Go to: https://dashboard.stripe.com/test/payments/$PAYMENT_INTENT_ID"
echo "2. Click 'Capture' button"
echo "3. Wait for webhook to fire"
echo ""

echo -e "${YELLOW}Step 3: Check Railway logs${NC}"
echo "Look for:"
echo "  - 'payment_intent.succeeded'"
echo "  - 'Booking updated to DRIVER_PENDING'"
echo ""

echo -e "${YELLOW}Step 4: Verify booking status changed${NC}"
echo "Run the SQL query again and check if:"
echo "  - status changed to 'DRIVER_PENDING'"
echo "  - paymentCapturedAt is now set"
echo ""

echo -e "${YELLOW}Alternative: Use Stripe CLI${NC}"
echo "If you have Stripe CLI installed:"
echo -e "${GREEN}stripe trigger payment_intent.succeeded --add payment_intent:metadata.bookingId=$BOOKING_ID${NC}"
echo ""

echo -e "${YELLOW}📊 Check webhook delivery in Stripe Dashboard:${NC}"
echo "https://dashboard.stripe.com/test/webhooks"
echo "Click on your webhook endpoint to see delivery attempts"
