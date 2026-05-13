# Notification Deep Links Reference

## Overview

All notifications in the carpooling app include deep links to navigate users directly to relevant screens in the mobile app.

---

## Deep Link Format

```
app://{screen}/{id}
```

**Examples:**
- `app://booking/cm123abc456` - Opens booking detail screen
- `app://driver/booking-request/cm123abc456` - Opens driver booking request screen
- `app://search-rides` - Opens search rides screen

---

## All Notification Types with Deep Links

### 1. Booking Notifications (Rider)

#### 1.1 Driver Accepted Booking
**Notification Type:** `booking.driver.accepted`

**When:** Driver accepts the booking request

**Deep Link:** `app://booking/{bookingId}`

**Example:**
```json
{
  "type": "booking.driver.accepted",
  "title": "Ride confirmed",
  "body": "Driver accepted your booking",
  "data": {
    "bookingId": "cm123abc456",
    "rideId": "ride-uuid",
    "pickupOtp": "123456",
    "dropOtp": "789012",
    "deepLink": "app://booking/cm123abc456"
  }
}
```

**Screen:** Booking detail screen showing:
- Driver information
- Vehicle details
- Pickup/drop OTPs
- Trip timeline

---

#### 1.2 Driver Rejected Booking
**Notification Type:** `booking.driver.rejected`

**When:** Driver rejects the booking request

**Deep Link:** `app://booking/{bookingId}`

**Example:**
```json
{
  "type": "booking.driver.rejected",
  "title": "Booking declined",
  "body": "The driver declined this ride request: I have an emergency",
  "data": {
    "bookingId": "cm123abc456",
    "rideId": "ride-uuid",
    "rejectionReason": "I have an emergency",
    "refundInitiated": "true",
    "refundPercent": "100",
    "deepLink": "app://booking/cm123abc456"
  }
}
```

**Screen:** Booking detail screen showing:
- Rejection reason
- Refund status
- Option to search for new ride

---

#### 1.3 Driver Cancelled After Accept
**Notification Type:** `booking.driver.cancelled`

**When:** Driver cancels a confirmed booking

**Deep Link:** `app://booking/{bookingId}`

**Example:**
```json
{
  "type": "booking.driver.cancelled",
  "title": "Ride cancelled by driver",
  "body": "Your driver cancelled this ride: Vehicle broke down. Refund has been initiated.",
  "data": {
    "bookingId": "cm123abc456",
    "rideId": "ride-uuid",
    "cancellationReason": "Vehicle broke down",
    "refundInitiated": "true",
    "refundPercent": "100",
    "deepLink": "app://booking/cm123abc456"
  }
}
```

**Screen:** Booking detail screen showing:
- Cancellation reason
- Refund status
- Option to search for new ride

---

#### 1.4 Trip Started
**Notification Type:** `booking.trip.started`

**When:** Driver verifies pickup OTP

**Deep Link:** `app://booking/{bookingId}`

**Example:**
```json
{
  "type": "booking.trip.started",
  "title": "Trip started",
  "body": "Your trip is now in progress",
  "data": {
    "bookingId": "cm123abc456",
    "rideId": "ride-uuid",
    "deepLink": "app://booking/cm123abc456"
  }
}
```

**Screen:** Active trip screen showing:
- Live location tracking
- Driver contact
- Drop OTP
- ETA

---

#### 1.5 Trip Completed
**Notification Type:** `booking.trip.completed`

**When:** Driver verifies drop OTP

**Deep Link:** `app://booking/{bookingId}`

**Example:**
```json
{
  "type": "booking.trip.completed",
  "title": "Trip completed",
  "body": "Your trip has been completed successfully",
  "data": {
    "bookingId": "cm123abc456",
    "rideId": "ride-uuid",
    "deepLink": "app://booking/cm123abc456"
  }
}
```

**Screen:** Trip summary screen showing:
- Trip details
- Payment receipt
- Rate driver option

---

#### 1.6 Booking Auto-Cancelled (Timeout)
**Notification Type:** `booking.timeout.cancelled`

**When:** Booking automatically cancelled due to driver timeout

**Deep Link:** `app://booking/{bookingId}`

**Example:**
```json
{
  "type": "booking.timeout.cancelled",
  "title": "Booking cancelled",
  "body": "Your booking was cancelled due to driver timeout. Full refund initiated.",
  "data": {
    "bookingId": "cm123abc456",
    "rideId": "ride-uuid",
    "refundInitiated": "true",
    "refundPercent": "100",
    "deepLink": "app://booking/cm123abc456"
  }
}
```

**Screen:** Booking detail screen showing:
- Cancellation reason
- Refund status
- Search new ride button

---

### 2. Driver Notifications

#### 2.1 New Booking Request
**Notification Type:** `booking.request.driver_decision`

**When:** Rider completes payment (booking moves to DRIVER_PENDING)

**Deep Link:** `app://driver/booking-request/{bookingId}`

**Example:**
```json
{
  "type": "booking.request.driver_decision",
  "title": "New ride request",
  "body": "John wants Palwal to Faridabad",
  "data": {
    "bookingId": "cm123abc456",
    "rideId": "ride-uuid",
    "passengerName": "John",
    "passengerAvatarUrl": "https://...",
    "originAddress": "Palwal",
    "destinationAddress": "Faridabad",
    "seatsBooked": "2",
    "totalPrice": "25.00",
    "currency": "GBP",
    "decisionDeadlineAt": "2026-05-13T10:00:00Z",
    "deepLink": "app://driver/booking-request/cm123abc456"
  }
}
```

**Screen:** Booking request screen showing:
- Passenger details
- Route information
- Price
- Countdown timer
- Accept/Reject buttons with reason input

---

#### 2.2 Rider Extended Wait (Planned)
**Notification Type:** `booking.rider.extended_wait`

**When:** Rider extends waiting period after deadline expires

**Deep Link:** `app://driver/booking-request/{bookingId}`

**Example:**
```json
{
  "type": "booking.rider.extended_wait",
  "title": "Rider is still waiting",
  "body": "The rider extended the waiting period. Please respond within 1 hour.",
  "data": {
    "bookingId": "cm123abc456",
    "rideId": "ride-uuid",
    "newDeadline": "2026-05-13T11:00:00Z",
    "deepLink": "app://driver/booking-request/cm123abc456"
  }
}
```

**Screen:** Booking request screen with updated deadline

---

### 3. Deadline Expiry Notifications (Planned)

#### 3.1 Deadline Expired (Rider)
**Notification Type:** `booking.driver.deadline_expired`

**When:** Driver doesn't respond within 1 hour

**Deep Link:** `app://booking/{bookingId}/deadline-expired`

**Example:**
```json
{
  "type": "booking.driver.deadline_expired",
  "title": "Driver hasn't responded yet",
  "body": "The driver hasn't confirmed your booking. You can wait 1 more hour or search for a new ride.",
  "data": {
    "bookingId": "cm123abc456",
    "rideId": "ride-uuid",
    "originAddress": "Palwal",
    "destinationAddress": "Faridabad",
    "action": "deadline_expired",
    "deepLink": "app://booking/cm123abc456/deadline-expired"
  }
}
```

**Screen:** Deadline expired screen showing:
- Wait 1 more hour button
- Cancel & search new ride button

---

#### 3.2 Auto-Cancelled After Extended Deadline
**Notification Type:** `booking.cancelled.no_driver_response`

**When:** Driver doesn't respond even after extended deadline

**Deep Link:** `app://search-rides`

**Example:**
```json
{
  "type": "booking.cancelled.no_driver_response",
  "title": "Booking cancelled",
  "body": "Your booking was cancelled due to no driver response. Full refund initiated.",
  "data": {
    "bookingId": "cm123abc456",
    "rideId": "ride-uuid",
    "refundAmount": "25.00",
    "refundInitiated": "true",
    "deepLink": "app://search-rides"
  }
}
```

**Screen:** Search rides screen to find alternative

---

## Deep Link Patterns Summary

| Pattern | Purpose | Example |
|---------|---------|---------|
| `app://booking/{id}` | Rider booking details | `app://booking/cm123abc456` |
| `app://booking/{id}/deadline-expired` | Deadline expired options | `app://booking/cm123abc456/deadline-expired` |
| `app://driver/booking-request/{id}` | Driver booking request | `app://driver/booking-request/cm123abc456` |
| `app://search-rides` | Search for rides | `app://search-rides` |
| `app://ride/{id}` | Ride details | `app://ride/ride-uuid` |
| `app://chat/{id}` | Chat with user | `app://chat/user-uuid` |

---

## Implementation in Mobile App

### React Native Example

```typescript
import { Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';

const handleDeepLink = (url: string) => {
  // Parse deep link
  const match = url.match(/app:\/\/(.+)/);
  if (!match) return;

  const path = match[1];
  const parts = path.split('/');

  // Route based on deep link
  switch (parts[0]) {
    case 'booking':
      if (parts[2] === 'deadline-expired') {
        navigation.navigate('BookingDeadlineExpired', { bookingId: parts[1] });
      } else {
        navigation.navigate('BookingDetail', { bookingId: parts[1] });
      }
      break;

    case 'driver':
      if (parts[1] === 'booking-request') {
        navigation.navigate('DriverBookingRequest', { bookingId: parts[2] });
      }
      break;

    case 'search-rides':
      navigation.navigate('SearchRides');
      break;

    case 'ride':
      navigation.navigate('RideDetail', { rideId: parts[1] });
      break;

    case 'chat':
      navigation.navigate('Chat', { userId: parts[1] });
      break;

    default:
      navigation.navigate('Home');
  }
};

// Listen for deep links
useEffect(() => {
  const subscription = Linking.addEventListener('url', ({ url }) => {
    handleDeepLink(url);
  });

  return () => subscription.remove();
}, []);

// Handle notification tap
messaging().onNotificationOpenedApp((remoteMessage) => {
  const deepLink = remoteMessage.data?.deepLink;
  if (deepLink) {
    handleDeepLink(deepLink);
  }
});
```

---

## Testing Deep Links

### Test on iOS Simulator
```bash
xcrun simctl openurl booted "app://booking/cm123abc456"
```

### Test on Android Emulator
```bash
adb shell am start -W -a android.intent.action.VIEW -d "app://booking/cm123abc456"
```

### Test with Firebase Console
1. Go to Firebase Console → Cloud Messaging
2. Send test notification
3. Add custom data: `{ "deepLink": "app://booking/cm123abc456" }`
4. Tap notification on device

---

## Best Practices

1. **Always include deepLink in notification data**
   ```typescript
   await createNotification({
     userId: userId,
     type: 'booking.driver.accepted',
     title: 'Ride confirmed',
     body: 'Driver accepted your booking',
     data: {
       bookingId: booking.id,
       deepLink: `app://booking/${booking.id}`, // REQUIRED
     },
   });
   ```

2. **Use consistent URL patterns**
   - Resource type first: `app://booking/...`
   - ID second: `app://booking/{id}`
   - Action last: `app://booking/{id}/deadline-expired`

3. **Handle missing IDs gracefully**
   ```typescript
   if (!bookingId) {
     navigation.navigate('Home');
     return;
   }
   ```

4. **Log deep link navigation**
   ```typescript
   console.log('[DeepLink] Navigating to:', url);
   analytics.logEvent('deep_link_opened', { url });
   ```

---

## Summary

✅ **All notifications include deep links**  
✅ **Consistent URL patterns**  
✅ **Direct navigation to relevant screens**  
✅ **Better user experience**  
✅ **Easy to test and debug**  

Deep links ensure users can quickly access the relevant screen when they tap on a notification!
