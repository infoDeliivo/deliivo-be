# Existing Features Summary - Ride Booking System

## ✅ Feature 1: OTP for Ride Verification (ALREADY EXISTS)

### Overview
The system **already has** pickup and drop OTP functionality for ride verification.

### How It Works

#### 1. When Driver Accepts Booking
```bash
POST /api/v1/driver/bookings/{bookingId}/accept
Authorization: Bearer <driver-token>
```

**What Happens:**
- Booking status changes to `CONFIRMED`
- System generates **2 OTPs**:
  - **Pickup OTP** (valid for 6 hours)
  - **Drop OTP** (valid for 24 hours)
- OTPs are sent to passenger via notification
- Driver receives the OTPs

**Response:**
```json
{
  "success": true,
  "data": {
    "bookingId": "booking-123",
    "status": "CONFIRMED",
    "pickupOtp": "1234",  // Sent to passenger
    "dropOtp": "5678",    // Sent to passenger
    "deepLink": "app://booking/booking-123"
  }
}
```

#### 2. Driver Verifies Pickup OTP (Start Ride)
```bash
POST /api/v1/driver/bookings/{bookingId}/pickup-otp/verify
Authorization: Bearer <driver-token>
{
  "otp": "1234"
}
```

**What Happens:**
- Validates the pickup OTP
- Changes booking status to `IN_PROGRESS`
- Marks `pickupOtpVerifiedAt` timestamp
- Ride officially starts

#### 3. Driver Verifies Drop OTP (End Ride)
```bash
POST /api/v1/driver/bookings/{bookingId}/drop-otp/verify
Authorization: Bearer <driver-token>
{
  "otp": "5678"
}
```

**What Happens:**
- Validates the drop OTP
- Changes booking status to `COMPLETED`
- Marks `dropOtpVerifiedAt` timestamp
- Ride officially ends

### OTP Security Features

✅ **Expiration Times:**
- Pickup OTP: 6 hours
- Drop OTP: 24 hours

✅ **Attempt Limits:**
- Maximum 5 attempts per OTP
- After 5 failed attempts, OTP is locked

✅ **Hashed Storage:**
- OTPs are hashed in database (not stored in plain text)
- Uses bcrypt for secure hashing

✅ **Error Handling:**
- `PICKUP_OTP_NOT_AVAILABLE` - OTP not generated yet
- `PICKUP_OTP_EXPIRED` - OTP expired
- `INVALID_PICKUP_OTP` - Wrong OTP entered
- `OTP_ATTEMPT_LIMIT_EXCEEDED` - Too many failed attempts

---

## ✅ Feature 2: Push Notifications (ALREADY EXISTS)

### Overview
The system has a complete notification system with push notifications.

### Notification Types

1. **Booking Confirmed** - When driver accepts booking
2. **Booking Rejected** - When driver rejects booking
3. **Booking Cancelled** - When booking is cancelled
4. **Ride Updates** - When ride details change
5. **Chat Messages** - New messages
6. **System Notifications** - General updates

### API Endpoints

#### Register Device for Push Notifications
```bash
POST /api/v1/notifications/devices/register
Authorization: Bearer <token>
{
  "platform": "ios",  // or "android"
  "token": "firebase-device-token"
}
```

#### Get User Notifications
```bash
GET /api/v1/notifications
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "notif-1",
      "type": "booking_confirmed",
      "title": "Booking Confirmed!",
      "body": "Your ride to Manchester has been confirmed",
      "data": {
        "bookingId": "booking-123",
        "rideId": "ride-456"
      },
      "isRead": false,
      "createdAt": "2026-04-12T10:00:00Z"
    }
  ]
}
```

#### Mark Notifications as Read
```bash
POST /api/v1/notifications/read
Authorization: Bearer <token>
{
  "notificationIds": ["notif-1", "notif-2"]
}
```

#### Get Unread Count
```bash
GET /api/v1/notifications/unread-count
Authorization: Bearer <token>
```

---

## ✅ Feature 3: Get All Bookings for a Ride (ALREADY EXISTS)

### Overview
Drivers can see all passengers who booked their ride.

### API Endpoints

#### Get Ride Details (Shows All Bookings)
```bash
GET /api/v1/search-rides/{rideId}
Authorization: Bearer <driver-token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "ride-123",
    "driver": {
      "id": "driver-1",
      "name": "John Driver",
      "avatarUrl": "..."
    },
    "bookings": [
      {
        "id": "booking-1",
        "passengerId": "passenger-1",
        "seatsBooked": 2,
        "status": "CONFIRMED",
        "pickupOtpVerifiedAt": null,
        "dropOtpVerifiedAt": null,
        "rider": {
          "id": "passenger-1",
          "name": "Alice",
          "nickName": "alice123",
          "phone": "+44123456789",
          "avatarUrl": "..."
        }
      },
      {
        "id": "booking-2",
        "passengerId": "passenger-2",
        "seatsBooked": 1,
        "status": "CONFIRMED",
        "rider": {
          "id": "passenger-2",
          "name": "Bob",
          "nickName": "bob456",
          "phone": "+44987654321",
          "avatarUrl": "..."
        }
      }
    ],
    "availableSeats": 1,
    "totalSeats": 4
  }
}
```

#### Get Driver's Published Rides
```bash
GET /api/v1/publish-ride
Authorization: Bearer <driver-token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "rides": [
      {
        "id": "ride-123",
        "status": "PUBLISHED",
        "bookings": [
          {
            "id": "booking-1",
            "rider": {
              "name": "Alice",
              "avatarUrl": "..."
            },
            "seatsBooked": 2,
            "status": "CONFIRMED"
          }
        ],
        "availableSeats": 1,
        "departureDate": "2026-04-15",
        "departureTime": "10:00"
      }
    ]
  }
}
```

---

## 📊 Complete Ride Flow with Existing Features

### Step 1: Driver Publishes Ride
```bash
POST /api/v1/publish-ride/draft/publish
```
- Ride status: `PUBLISHED`
- Available for passengers to search

### Step 2: Passenger Books Ride
```bash
POST /api/v1/bookings
```
- Booking status: `PAYMENT_PENDING` → `DRIVER_PENDING`
- Driver receives notification: "New booking request"

### Step 3: Driver Accepts Booking
```bash
POST /api/v1/driver/bookings/{id}/accept
```
- Booking status: `CONFIRMED`
- **Pickup OTP** and **Drop OTP** generated
- Passenger receives notification with OTPs
- Driver can see OTPs

### Step 4: Ride Day - Driver Starts Ride
```bash
POST /api/v1/driver/bookings/{id}/pickup-otp/verify
{
  "otp": "1234"
}
```
- Passenger shows pickup OTP to driver
- Driver enters OTP
- Booking status: `IN_PROGRESS`
- Ride officially starts

### Step 5: Ride Ends - Driver Completes Ride
```bash
POST /api/v1/driver/bookings/{id}/drop-otp/verify
{
  "otp": "5678"
}
```
- Passenger shows drop OTP to driver
- Driver enters OTP
- Booking status: `COMPLETED`
- Ride officially ends

### Step 6: Rating (NEW FEATURE)
```bash
POST /api/v1/ratings/bookings/{bookingId}
{
  "stars": 5,
  "reviewText": "Great ride!"
}
```
- Passenger rates driver
- Driver rates passenger

---

## 🔍 How to Check These Features

### 1. Check OTP in Database
```sql
SELECT 
  id,
  status,
  "pickupOtpHash",
  "pickupOtpExpiresAt",
  "pickupOtpVerifiedAt",
  "dropOtpHash",
  "dropOtpExpiresAt",
  "dropOtpVerifiedAt",
  "otpAttemptCount"
FROM "RideBooking"
WHERE id = 'your-booking-id';
```

### 2. Check Notifications
```sql
SELECT * FROM "Notification"
WHERE "userId" = 'your-user-id'
ORDER BY "createdAt" DESC;
```

### 3. Check Device Tokens
```sql
SELECT * FROM "DeviceToken"
WHERE "userId" = 'your-user-id';
```

---

## 📱 Frontend Integration Examples

### Show OTPs to Passenger
```jsx
{booking.status === 'CONFIRMED' && (
  <div className="otp-section">
    <h3>Your OTPs</h3>
    <div className="otp-card">
      <p>Pickup OTP (show to driver at start):</p>
      <h2>{booking.pickupOtp}</h2>
    </div>
    <div className="otp-card">
      <p>Drop OTP (show to driver at end):</p>
      <h2>{booking.dropOtp}</h2>
    </div>
  </div>
)}
```

### Driver Verifies OTP
```jsx
const verifyPickupOtp = async () => {
  const response = await fetch(
    `/api/v1/driver/bookings/${bookingId}/pickup-otp/verify`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ otp: enteredOtp })
    }
  );
  
  if (response.ok) {
    alert('Ride started!');
  } else {
    alert('Invalid OTP');
  }
};
```

### Show All Passengers to Driver
```jsx
<div className="passengers-list">
  <h3>Passengers ({ride.bookings.length})</h3>
  {ride.bookings.map(booking => (
    <div key={booking.id} className="passenger-card">
      <img src={booking.rider.avatarUrl} />
      <div>
        <h4>{booking.rider.name}</h4>
        <p>{booking.seatsBooked} seats</p>
        <p>Status: {booking.status}</p>
        {booking.status === 'CONFIRMED' && (
          <button onClick={() => verifyPickup(booking.id)}>
            Verify Pickup OTP
          </button>
        )}
      </div>
    </div>
  ))}
</div>
```

---

## ✅ Summary

All the features you requested **ALREADY EXIST**:

1. ✅ **OTP for ride sharing** - Pickup and Drop OTPs
2. ✅ **Push notifications** - Complete notification system
3. ✅ **Get all bookings** - Driver can see all passengers
4. ✅ **Booking status tracking** - Full lifecycle management
5. ✅ **Rating system** - NEW (just implemented)

The system is fully functional and ready to use!
