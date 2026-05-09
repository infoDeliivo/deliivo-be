# Quick Fix Guide: Driver Not Receiving Notifications

## 🚨 Problem
Driver doesn't receive notification after user pays for booking.

## ✅ Solution (3 Steps)

### Step 1: Check if Driver is Connected
```bash
npx tsx monitor-websocket-connections.ts
```

**Expected:** Driver's user ID should appear in the list.

**If driver NOT in list:**
- Driver's mobile app is not connected to WebSocket
- Fix: Ensure mobile app connects on launch

### Step 2: Test Notification Manually
```bash
npx tsx test-websocket-notification.ts <driver-user-id>
```

**Expected:** 
- Script shows "User has X active socket(s)" where X > 0
- Driver receives notification in app

**If fails:**
- Check mobile app WebSocket implementation
- Verify JWT token is valid

### Step 3: Check Logs
```bash
tail -f logs/combined.log | grep -i "notification\|driver"
```

**Expected flow:**
```
🔔 Webhook received
✅ Booking updated to DRIVER_PENDING
🔔 Sending notification to driver
📬 Creating notification
📡 User has X active socket(s)
✅ Emitted 'notification:new' event
```

**If missing any step:** Check that specific component

## 🔧 Mobile App Fix

The driver's app MUST have this code:

```javascript
import io from 'socket.io-client';

// 1. Connect with JWT token
const socket = io('https://your-api.com', {
    auth: { token: userJwtToken }
});

// 2. Listen for notifications
socket.on('notification:new', (payload) => {
    console.log('📬 Notification:', payload);
    showNotification(payload.data);
});

// 3. Handle connection
socket.on('connect', () => {
    console.log('✅ Connected');
});

socket.on('disconnect', () => {
    console.log('❌ Disconnected');
});
```

## 🎯 Common Issues

| Issue | Symptom | Fix |
|-------|---------|-----|
| Driver not connected | Monitor shows 0 connections | Connect in mobile app |
| Wrong event name | Logs show "Emitted" but not received | Use `'notification:new'` |
| JWT expired | Connection fails | Refresh token |
| Socket.IO not running | "Instance not available" in logs | Restart server |

## 📊 Diagnostic Commands

```bash
# Check who's connected
npx tsx monitor-websocket-connections.ts

# Test notification
npx tsx test-websocket-notification.ts <driver-id>

# Full diagnostic
DRIVER_USER_ID=<driver-id> BOOKING_ID=<booking-id> ./test-driver-notification.sh

# Watch logs
tail -f logs/combined.log | grep -i "notification"

# Check Redis
redis-cli GET "presence:<driver-id>"
```

## 📱 Event Name (IMPORTANT!)

**Server emits:** `'notification:new'`  
**Client must listen to:** `'notification:new'`

NOT:
- ❌ `'notification'`
- ❌ `'new-notification'`
- ❌ `'driver-notification'`

## 🎉 Success Indicators

✅ Monitor shows driver connected  
✅ Test notification is received  
✅ Logs show "Emitted 'notification:new' event"  
✅ Driver sees notification in app  

## 📚 Full Documentation

- `ISSUE_SUMMARY.md` - Complete issue analysis
- `WEBSOCKET_NOTIFICATION_FIX.md` - Detailed fix guide
- `debug-driver-websocket.md` - Debugging guide

## 🆘 Still Not Working?

1. Share output of: `npx tsx monitor-websocket-connections.ts`
2. Share output of: `npx tsx test-websocket-notification.ts <driver-id>`
3. Share mobile app WebSocket connection code
4. Share last 50 lines of logs: `tail -50 logs/combined.log`
