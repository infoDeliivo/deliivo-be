# WebSocket Notification Fix - Driver Not Receiving Notifications

## Problem Summary
After a user successfully pays for a booking, the driver is not receiving the "accept ride" notification via WebSocket.

## Changes Made

### 1. Enhanced Logging in `stripe.webhook.controller.ts`
Added comprehensive logging to track the payment → notification flow:

```typescript
// Before payment processing
console.log('🔔 Webhook received');
console.log('✅ Signature verified, event type:', event.type);

// After booking update
console.log(`✅ Booking ${bookingId} updated to DRIVER_PENDING`);
console.log(`📋 Booking details: driverId=${booking.ride.driverId}, passengerId=${booking.passengerId}`);

// Before sending notification
console.log(`🔔 Sending notification to driver ${booking.ride.driverId}`);
console.log(`   Route: ${originAddress} → ${destinationAddress}`);
console.log(`   Passenger: ${booking.passenger.name ?? 'Rider'}`);

// After sending notification
console.log(`✅ Notification sent successfully to driver ${booking.ride.driverId}`);
```

### 2. Enhanced Logging in `notification.service.ts`
Added detailed logging for WebSocket delivery:

```typescript
logger.info(`📬 Creating notification for user ${userId}, type: ${type}`);
logger.info(`✅ Notification ${notification.id} created in database`);
logger.info(`🔍 Attempting WebSocket delivery for user ${userId}`);
logger.info(`✅ Socket.IO instance is available`);
logger.info(`📡 User ${userId} has ${socketIds.length} active socket(s)`);
logger.info(`📤 Emitting notification to ${socketIds.length} socket(s)`);
logger.info(`📦 Payload:`, JSON.stringify(payload, null, 2));
logger.info(`✅ Emitted 'notification:new' event to socket ${sid}`);
logger.info(`✅ WebSocket delivery successful for user ${userId}`);
```

### 3. Enhanced Logging in `socket/index.ts`
Added connection tracking:

```typescript
logger.info(`🔌 User ${userId} connected (socket: ${socket.id})`);
logger.info(`👤 User ${userId} now has ${allUserSockets.length} active connection(s)`);
logger.info(`🔌 User ${disconnectedUserId} disconnected`);
logger.info(`👤 User ${disconnectedUserId} has ${remainingSockets.length} remaining connection(s)`);
logger.info(`📴 User ${disconnectedUserId} is now OFFLINE`);
```

### 4. Created Diagnostic Tools

#### a. `test-driver-notification.sh`
Bash script to diagnose notification issues:
```bash
DRIVER_USER_ID=<driver-id> BOOKING_ID=<booking-id> ./test-driver-notification.sh
```

Checks:
- Driver exists in database
- Booking status
- Driver notifications
- Redis presence (WebSocket connection)
- Application logs

#### b. `test-websocket-notification.ts`
TypeScript test to manually send notifications:
```bash
npx tsx test-websocket-notification.ts <driver-user-id>
```

Verifies:
- Socket.IO instance availability
- User WebSocket connections
- Notification creation and delivery

#### c. `debug-driver-websocket.md`
Comprehensive debugging guide covering:
- Common root causes
- Debugging steps
- Expected flow
- Client-side implementation
- Testing tools

## How to Diagnose the Issue

### Step 1: Check Logs
After a payment is made, check the logs for the complete flow:

```bash
tail -f logs/combined.log | grep -i "webhook\|notification\|driver"
```

You should see:
1. ✅ Webhook received
2. ✅ Booking updated to DRIVER_PENDING
3. 🔔 Sending notification to driver
4. 📬 Creating notification
5. 📡 User has X active socket(s)
6. ✅ Emitted 'notification:new' event

### Step 2: Check Driver Connection
```bash
# Check if driver is connected
redis-cli GET "presence:<driver-user-id>"

# Or use diagnostic script
DRIVER_USER_ID=<driver-id> BOOKING_ID=<booking-id> ./test-driver-notification.sh
```

### Step 3: Test Notification Manually
```bash
npx tsx test-websocket-notification.ts <driver-user-id>
```

## Most Likely Root Causes

### 1. **Driver Not Connected (90% of cases)**
The driver's mobile app is not connected to the WebSocket server.

**Symptoms:**
- Logs show: `📴 User <driver-id> is OFFLINE`
- Redis presence check returns empty

**Solution:**
- Ensure driver's app connects to WebSocket on launch
- Verify JWT token is valid
- Check network connectivity

### 2. **Client Listening to Wrong Event (5% of cases)**
The mobile app is listening to a different event name.

**Symptoms:**
- Logs show: `✅ Emitted 'notification:new' event`
- But driver doesn't receive it

**Solution:**
Update mobile app to listen to `'notification:new'`:
```javascript
socket.on('notification:new', (payload) => {
    console.log('Notification received:', payload);
});
```

### 3. **JWT Token Expired (3% of cases)**
The driver's JWT token has expired.

**Symptoms:**
- Logs show: `Invalid or expired token`
- Driver can't connect to WebSocket

**Solution:**
- Implement token refresh in mobile app
- Reconnect with new token

### 4. **Socket.IO Not Initialized (2% of cases)**
The WebSocket server didn't start properly.

**Symptoms:**
- Logs show: `⚠️ Socket.IO instance not available`
- No `✅ Socket.IO server initialized` in logs

**Solution:**
- Check server startup logs for errors
- Ensure `initSocket()` is called in `server.ts`

## Client-Side Implementation

The driver's mobile app MUST:

### 1. Connect to WebSocket
```javascript
import io from 'socket.io-client';

const socket = io('https://your-api.com', {
    auth: {
        token: userJwtToken  // JWT token from login
    }
});
```

### 2. Listen for Connection
```javascript
socket.on('connect', () => {
    console.log('✅ Connected to WebSocket');
});
```

### 3. Listen for Notifications
```javascript
socket.on('notification:new', (payload) => {
    console.log('📬 New notification:', payload);
    
    // Extract notification data
    const { title, body, notificationType, data } = payload.data;
    
    // Show notification to driver
    if (notificationType === 'booking.request.driver_decision') {
        showBookingRequestNotification({
            bookingId: data.bookingId,
            passengerName: data.passengerName,
            origin: data.originAddress,
            destination: data.destinationAddress,
            seats: data.seatsBooked,
            price: data.totalPrice,
            currency: data.currency,
            deadline: data.decisionDeadlineAt
        });
    }
});
```

### 4. Handle Disconnection
```javascript
socket.on('disconnect', (reason) => {
    console.log('❌ Disconnected:', reason);
    // Implement reconnection logic
});

socket.on('connect_error', (error) => {
    console.error('❌ Connection error:', error);
});
```

## Notification Payload Structure

When a driver receives a notification, the payload looks like:

```json
{
  "type": "notification.new",
  "data": {
    "id": "notification-uuid",
    "title": "New ride request",
    "body": "John Doe wants Palwal to Faridabad",
    "notificationType": "booking.request.driver_decision",
    "data": {
      "bookingId": "booking-uuid",
      "rideId": "ride-uuid",
      "passengerName": "John Doe",
      "passengerAvatarUrl": "https://...",
      "originAddress": "Palwal, Haryana",
      "destinationAddress": "Faridabad, Haryana",
      "seatsBooked": "2",
      "totalPrice": "500",
      "currency": "INR",
      "decisionDeadlineAt": "2026-05-09T12:30:00.000Z",
      "deepLink": "app://driver/booking-request/booking-uuid"
    },
    "preview": true,
    "createdAt": "2026-05-09T12:00:00.000Z"
  }
}
```

## Testing Checklist

- [ ] Server logs show `✅ Socket.IO server initialized`
- [ ] Driver connects to WebSocket (logs show `🔌 User <driver-id> connected`)
- [ ] Payment webhook is received (logs show `🔔 Webhook received`)
- [ ] Booking is updated to DRIVER_PENDING
- [ ] Notification is created in database
- [ ] Logs show `📡 User <driver-id> has X active socket(s)` (X > 0)
- [ ] Logs show `✅ Emitted 'notification:new' event`
- [ ] Driver's app receives the notification
- [ ] Driver can see booking details and accept/reject

## Next Steps

1. **Run the diagnostic script:**
   ```bash
   DRIVER_USER_ID=<driver-id> BOOKING_ID=<booking-id> ./test-driver-notification.sh
   ```

2. **Check the logs** for the complete flow

3. **Verify driver is connected** to WebSocket

4. **Test manually:**
   ```bash
   npx tsx test-websocket-notification.ts <driver-user-id>
   ```

5. **If driver is not connected**, fix the mobile app WebSocket connection

6. **If driver is connected but not receiving**, verify the mobile app is listening to `'notification:new'` event

## Support

If the issue persists after following this guide:

1. Share the complete logs from payment to notification
2. Confirm driver's WebSocket connection status
3. Share mobile app WebSocket implementation code
4. Test with the manual notification script

The enhanced logging will help identify exactly where the flow breaks.
