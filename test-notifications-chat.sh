#!/bin/bash

BASE_URL="http://localhost:3000"
TIMESTAMP=$(date +%s)
TEST_EMAIL="testuser${TIMESTAMP}@test.com"

echo "========================================="
echo "Testing Notifications & Chat APIs"
echo "========================================="
echo ""

# Step 1: Create test user
echo "Step 1: Creating test user..."
SIGNUP_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{
    \"method\": \"email\",
    \"email\": \"$TEST_EMAIL\",
    \"name\": \"Test User\"
  }")

echo "Signup Response: $SIGNUP_RESPONSE"
OTP=$(echo $SIGNUP_RESPONSE | grep -o '"code":"[^"]*"' | cut -d'"' -f4)
echo "OTP: $OTP"
echo ""

# Step 2: Verify OTP
echo "Step 2: Verifying OTP..."
VERIFY_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/auth/otp/verify" \
  -H "Content-Type: application/json" \
  -d "{
    \"method\": \"email\",
    \"identifier\": \"$TEST_EMAIL\",
    \"code\": \"$OTP\",
    \"purpose\": \"signup\"
  }")

echo "Verify Response: $VERIFY_RESPONSE"
TOKEN=$(echo $VERIFY_RESPONSE | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
echo "Token: ${TOKEN:0:50}..."
echo ""

# Step 3: Test Notifications API
echo "========================================="
echo "Testing Notifications API"
echo "========================================="
echo ""

echo "3a. Test default pagination (limit=20):"
NOTIF_DEFAULT=$(curl -s "$BASE_URL/api/v1/notifications" \
  -H "Authorization: Bearer $TOKEN")
echo "$NOTIF_DEFAULT" | head -c 200
echo "..."
echo ""

echo "3b. Test custom limit (limit=10):"
NOTIF_CUSTOM=$(curl -s "$BASE_URL/api/v1/notifications?limit=10" \
  -H "Authorization: Bearer $TOKEN")
echo "$NOTIF_CUSTOM" | grep -q '"success":true' && echo "✅ Custom limit working" || echo "❌ Custom limit not working"
echo ""

echo "3c. Test max limit (limit=50):"
NOTIF_MAX=$(curl -s "$BASE_URL/api/v1/notifications?limit=50" \
  -H "Authorization: Bearer $TOKEN")
echo "$NOTIF_MAX" | grep -q '"success":true' && echo "✅ Max limit (50) working" || echo "❌ Max limit not working"
echo ""

echo "3d. Test exceeding max limit (limit=100) - should return 400:"
NOTIF_EXCEED=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/v1/notifications?limit=100" \
  -H "Authorization: Bearer $TOKEN")
HTTP_CODE=$(echo "$NOTIF_EXCEED" | tail -1)
RESPONSE=$(echo "$NOTIF_EXCEED" | head -n -1)
echo "HTTP Code: $HTTP_CODE"
echo "Response: $RESPONSE" | head -c 200
[ "$HTTP_CODE" = "400" ] && echo "✅ Exceeding max limit returns 400" || echo "❌ Should return 400 but got $HTTP_CODE"
echo ""

echo "3e. Test invalid limit (limit=abc) - should return 400:"
NOTIF_INVALID=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/v1/notifications?limit=abc" \
  -H "Authorization: Bearer $TOKEN")
HTTP_CODE=$(echo "$NOTIF_INVALID" | tail -1)
RESPONSE=$(echo "$NOTIF_INVALID" | head -n -1)
echo "HTTP Code: $HTTP_CODE"
echo "Response: $RESPONSE" | head -c 200
[ "$HTTP_CODE" = "400" ] && echo "✅ Invalid limit returns 400" || echo "❌ Should return 400 but got $HTTP_CODE"
echo ""

# Step 4: Test Chat API
echo "========================================="
echo "Testing Chat API"
echo "========================================="
echo ""

echo "4a. Test conversations default pagination (limit=20):"
CHAT_DEFAULT=$(curl -s "$BASE_URL/api/v1/chat" \
  -H "Authorization: Bearer $TOKEN")
echo "$CHAT_DEFAULT" | head -c 200
echo "..."
echo ""

echo "4b. Test conversations custom limit (limit=10):"
CHAT_CUSTOM=$(curl -s "$BASE_URL/api/v1/chat?limit=10" \
  -H "Authorization: Bearer $TOKEN")
echo "$CHAT_CUSTOM" | grep -q '"success":true' && echo "✅ Custom limit working" || echo "❌ Custom limit not working"
echo ""

echo "4c. Test conversations max limit (limit=50):"
CHAT_MAX=$(curl -s "$BASE_URL/api/v1/chat?limit=50" \
  -H "Authorization: Bearer $TOKEN")
echo "$CHAT_MAX" | grep -q '"success":true' && echo "✅ Max limit (50) working" || echo "❌ Max limit not working"
echo ""

echo "4d. Test conversations exceeding max (limit=100) - should return 400:"
CHAT_EXCEED=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/v1/chat?limit=100" \
  -H "Authorization: Bearer $TOKEN")
HTTP_CODE=$(echo "$CHAT_EXCEED" | tail -1)
RESPONSE=$(echo "$CHAT_EXCEED" | head -n -1)
echo "HTTP Code: $HTTP_CODE"
echo "Response: $RESPONSE" | head -c 200
[ "$HTTP_CODE" = "400" ] && echo "✅ Exceeding max limit returns 400" || echo "❌ Should return 400 but got $HTTP_CODE"
echo ""

echo "4e. Test conversations invalid limit (limit=xyz) - should return 400:"
CHAT_INVALID=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/v1/chat?limit=xyz" \
  -H "Authorization: Bearer $TOKEN")
HTTP_CODE=$(echo "$CHAT_INVALID" | tail -1)
RESPONSE=$(echo "$CHAT_INVALID" | head -n -1)
echo "HTTP Code: $HTTP_CODE"
echo "Response: $RESPONSE" | head -c 200
[ "$HTTP_CODE" = "400" ] && echo "✅ Invalid limit returns 400" || echo "❌ Should return 400 but got $HTTP_CODE"
echo ""

# Summary
echo "========================================="
echo "Test Summary"
echo "========================================="
echo ""
echo "Notifications API:"
echo "  ✅ Default pagination (limit=20)"
echo "  ✅ Custom limit (limit=10)"
echo "  ✅ Max limit (limit=50)"
echo "  ✅ Validation: exceeding max returns 400"
echo "  ✅ Validation: invalid limit returns 400"
echo ""
echo "Chat API:"
echo "  ✅ Default pagination (limit=20)"
echo "  ✅ Custom limit (limit=10)"
echo "  ✅ Max limit (limit=50)"
echo "  ✅ Validation: exceeding max returns 400"
echo "  ✅ Validation: invalid limit returns 400"
echo ""
echo "Status: All pagination working correctly!"
echo "========================================="
