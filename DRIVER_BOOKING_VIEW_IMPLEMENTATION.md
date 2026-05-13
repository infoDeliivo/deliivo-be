# Driver Booking View Implementation

## Summary

Added functionality for drivers to view all bookings (riders) for their rides with status information and decision deadline timestamps.

---

## What Was Implemented

### 1. **Enhanced Ride Endpoints**

#### `GET /api/publish-ride` - List Driver's Rides
- Returns all rides published by the driver
- Each ride includes all active bookings with passenger details
- Supports pagination and status filtering

#### `GET /api/publish-ride/:id` - Get Specific Ride
- Returns detailed ride information
- Includes all bookings with enhanced information:
  - Passenger details (name, phone, avatar)
  - Pickup and dropoff locations
  - Decision deadline for DRIVER_PENDING bookings
  - Time remaining calculations

---

## Key Features

### 1. **Decision Deadline Information**

For bookings with status `DRIVER_PENDING`, the API now returns:

```json
{
  "decisionDeadline": {
    "deadlineAt": "2026-05-13T09:15:00.000Z",
    "timeRemainingMs": 600000,
    "timeRemainingSeconds": 600,
    "isExpired": false
  }
}
```

**Fields:**
- `deadlineAt` - ISO timestamp when the decision window expires
- `timeRemainingMs` - Milliseconds remaining (for precise calculations)
- `timeRemainingSeconds` - Seconds remaining (for countdown timers)
- `isExpired` - Boolean flag indicating if deadline has passed

### 2. **Pickup/Dropoff Location Resolution**

Each booking now includes resolved pickup and dropoff locations:

```json
{
  "pickupLocation": {
    "address": "Palwal, Haryana",
    "placeId": "ChIJ..."
  },
  "dropoffLocation": {
    "address": "Faridabad, Haryana",
    "placeId": "ChIJ..."
  }
}
```

**Logic:**
- If booking has `pickupWaypointId`, uses that waypoint's address
- Otherwise, uses ride's origin address
- Same logic applies for dropoff location

### 3. **Passenger Information**

Each booking includes passenger details:

```json
{
  "passenger": {
    "id": "passenger-uuid",
    "name": "John Doe",
    "nickName": "Johnny",
    "phone": "+44123456789",
    "avatarUrl": "https://..."
  }
}
```

---

## Files Modified

### 1. **Service Layer**
**File:** `src/modules/publish-ride/publish-ride.service.ts`

**Changes:**
- Enhanced `getRideById()` to add decision deadline calculations
- Enhanced `getUserRides()` to add decision deadline calculations
- Added pickup/dropoff location resolution logic
- Real-time calculation of time remaining

### 2. **Validator**
**File:** `src/modules/driver-booking/driver-booking.validator.ts`

**Changes:**
- Added `listDriverBookingsQuerySchema` for future driver booking list endpoint

---

## API Response Example

### Request
```http
GET /api/publish-ride/cm123abc456
Authorization: Bearer <driver-token>
```

### Response
```json
{
  "success": true,
  "message": "Ride fetched successfully",
  "data": {
    "id": "cm123abc456",
    "driverId": "driver-uuid",
    "originAddress": "Palwal, Haryana",
    "destinationAddress": "Faridabad, Haryana",
    "departureDate": "2026-05-15T00:00:00.000Z",
    "departureTime": "08:00",
    "totalSeats": 4,
    "availableSeats": 2,
    "basePricePerSeat": 10.00,
    "currency": "GBP",
    "status": "PUBLISHED",
    "bookings": [
      {
        "id": "booking-1",
        "passengerId": "passenger-1-uuid",
        "seatsBooked": 2,
        "totalPrice": 20.00,
        "status": "DRIVER_PENDING",
        "createdAt": "2026-05-13T09:00:00.000Z",
        "passenger": {
          "id": "passenger-1-uuid",
          "name": "John Doe",
          "phone": "+44123456789",
          "avatarUrl": "https://..."
        },
        "pickupLocation": {
          "address": "Palwal, Haryana",
          "placeId": "ChIJ..."
        },
        "dropoffLocation": {
          "address": "Faridabad, Haryana",
          "placeId": "ChIJ..."
        },
        "decisionDeadline": {
          "deadlineAt": "2026-05-13T09:15:00.000Z",
          "timeRemainingMs": 600000,
          "timeRemainingSeconds": 600,
          "isExpired": false
        }
      }
    ]
  }
}
```

---

## Frontend Integration Guide

### 1. **Display Pending Bookings with Countdown**

```typescript
// Filter pending bookings
const pendingBookings = ride.bookings.filter(
  booking => booking.status === 'DRIVER_PENDING'
);

// Display countdown timer
pendingBookings.forEach(booking => {
  if (booking.decisionDeadline && !booking.decisionDeadline.isExpired) {
    const minutes = Math.floor(booking.decisionDeadline.timeRemainingSeconds / 60);
    const seconds = booking.decisionDeadline.timeRemainingSeconds % 60;
    
    console.log(`${minutes}:${seconds.toString().padStart(2, '0')} remaining`);
    // Display: "10:00 remaining to accept/reject"
  }
});
```

### 2. **Show Booking Status Badge**

```typescript
const getStatusBadge = (status: string) => {
  switch (status) {
    case 'DRIVER_PENDING':
      return { text: 'Pending Decision', color: 'orange' };
    case 'CONFIRMED':
      return { text: 'Confirmed', color: 'green' };
    case 'IN_PROGRESS':
      return { text: 'In Progress', color: 'blue' };
    case 'COMPLETED':
      return { text: 'Completed', color: 'gray' };
    default:
      return { text: status, color: 'gray' };
  }
};
```

### 3. **Calculate Total Earnings**

```typescript
const calculateEarnings = (bookings: Booking[]) => {
  return bookings
    .filter(b => ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(b.status))
    .reduce((sum, b) => sum + b.totalPrice, 0);
};

const totalEarnings = calculateEarnings(ride.bookings);
console.log(`Total earnings: £${totalEarnings.toFixed(2)}`);
```

### 4. **Display Rider Information**

```typescript
const RiderCard = ({ booking }) => (
  <div className="rider-card">
    <img src={booking.passenger.avatarUrl} alt={booking.passenger.name} />
    <div>
      <h3>{booking.passenger.name}</h3>
      <p>{booking.passenger.phone}</p>
      <p>{booking.seatsBooked} seat(s) - £{booking.totalPrice}</p>
      <p>From: {booking.pickupLocation.address}</p>
      <p>To: {booking.dropoffLocation.address}</p>
      
      {booking.status === 'DRIVER_PENDING' && booking.decisionDeadline && (
        <div className="countdown">
          <CountdownTimer seconds={booking.decisionDeadline.timeRemainingSeconds} />
          <button onClick={() => acceptBooking(booking.id)}>Accept</button>
          <button onClick={() => rejectBooking(booking.id)}>Reject</button>
        </div>
      )}
    </div>
  </div>
);
```

---

## Testing

### Test Scenario 1: View Ride with Pending Booking

```bash
# 1. Create a booking (as rider)
POST /api/bookings
{
  "rideId": "ride-uuid",
  "seatsBooked": 2
}

# 2. Complete payment (webhook will set status to DRIVER_PENDING)

# 3. View ride as driver
GET /api/publish-ride/ride-uuid

# Expected: Booking appears with DRIVER_PENDING status and decisionDeadline
```

### Test Scenario 2: Check Expired Deadline

```bash
# 1. Wait for decision deadline to pass (or manually set past deadline in DB)

# 2. View ride as driver
GET /api/publish-ride/ride-uuid

# Expected: decisionDeadline.isExpired = true, timeRemainingSeconds = 0
```

### Test Scenario 3: View Multiple Bookings

```bash
# 1. Create multiple bookings with different statuses

# 2. View ride as driver
GET /api/publish-ride/ride-uuid

# Expected: All bookings appear with their respective statuses
# - DRIVER_PENDING bookings have decisionDeadline
# - CONFIRMED bookings don't have decisionDeadline
```

---

## Database Fields Used

The implementation uses these existing database fields:

```prisma
model RideBooking {
  id                        String        @id
  rideId                    String
  passengerId               String
  seatsBooked               Int
  totalPrice                Float
  status                    BookingStatus
  
  // Decision deadline (set when payment captured)
  driverDecisionDeadlineAt  DateTime?
  driverDecisionAt          DateTime?
  
  // Segment booking
  pickupWaypointId          String?
  dropoffWaypointId         String?
  
  createdAt                 DateTime
  updatedAt                 DateTime
  
  // Relations
  passenger                 User          @relation(...)
  ride                      Ride          @relation(...)
}
```

---

## Next Steps

### Optional Enhancements

1. **WebSocket Real-time Updates**
   - Push booking updates to driver in real-time
   - Update countdown timer without polling

2. **Push Notifications**
   - Notify driver when new booking arrives
   - Remind driver when deadline approaching

3. **Booking Filters**
   - Filter by status (pending, confirmed, etc.)
   - Sort by deadline (urgent first)

4. **Batch Actions**
   - Accept/reject multiple bookings at once
   - Bulk notifications to riders

5. **Analytics**
   - Show acceptance rate
   - Average response time
   - Earnings statistics

---

## Summary

✅ Drivers can now view all bookings for their rides  
✅ Decision deadline with time remaining is calculated in real-time  
✅ Pickup/dropoff locations are resolved automatically  
✅ Passenger information is included  
✅ Works with existing booking flow  
✅ No database schema changes required  

The implementation is complete and ready for frontend integration!
