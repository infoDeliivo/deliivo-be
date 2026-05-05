#!/bin/bash

# Stripe Payment Intent Confirmation Test
# Payment Intent ID: pi_3TT71L8tCboslOE20TjkZStw

echo "🔐 Testing Stripe Payment Intent Confirmation..."
echo ""

# Read environment variables
source .env

PAYMENT_INTENT_ID="pi_3TT71L8tCboslOE20TjkZStw"
CLIENT_SECRET="pi_3TT71L8tCboslOE20TjkZStw_secret_SLPa4KtX1YGdgjBom2ouiqP0o"

echo "📋 Payment Intent ID: $PAYMENT_INTENT_ID"
echo ""

# Confirm the payment intent with a test card
echo "💳 Confirming payment with test card..."
curl https://api.stripe.com/v1/payment_intents/$PAYMENT_INTENT_ID/confirm \
  -u "$STRIPE_SECRET_KEY:" \
  -d "payment_method=pm_card_visa" \
  -d "return_url=https://example.com/return"

echo ""
echo ""
echo "✅ Payment confirmation request sent!"
echo ""

# Check the payment intent status
echo "🔍 Checking payment intent status..."
curl https://api.stripe.com/v1/payment_intents/$PAYMENT_INTENT_ID \
  -u "$STRIPE_SECRET_KEY:"

echo ""
echo ""
echo "✨ Done!"
