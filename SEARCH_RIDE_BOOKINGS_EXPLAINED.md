# Search Ride - Bookings & Passengers Information

## Overview

When users search for rides, the API returns **complete information** about:
1. ✅ **All passengers** who have booked the ride (with names, avatars)
2. ✅ **Whether the current user** has already booked the ride
3. ✅ **Available seats** remaining

## Response Structure

```json
{
  "rides": [
    {
      "id": "ride-123",
      "driver": {
        "id": "driver-1",
        "name": "John Driver",
        "avatarUrl": "https://example.com/john.jpg"
      },
      "hasActiveBooking": true,  // ← Current user already booked
      "bookings": [              // ← ALL passengers who booked
        {
          "id": "booking-1",
          "passengerId": "passenger-1",
          "seatsBooked": 2,
          "status": "CONFIRMED",
          "rider": {
            "id": "passenger-1",
            "name": "Alice",
            "nickName": "alice123",
            "phone": "+44123456789",
            "avatarUrl": "https://example.com/alice.jpg"
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
            "avatarUrl": "https://example.com/bob.jpg"
          }
        }
      ],
      "availableSeats": 1,  // 4 total - 2 (Alice) - 1 (Bob) = 1 remaining
      "totalSeats": 4,
      "basePricePerSeat": 15.00,
      "originAddress": "London, UK",
      "destinationAddress": "Manchester, UK",
      "departureDate": "2026-04-15",
      "departureTime": "10:00"
    }
  ]
}
```

## Key Fields Explained

### 1. `hasActiveBooking` (boolean)
- `true` = Current searching user has already booked this ride
- `false` = Current searching user has NOT booked this ride
- Only applies to the **authenticated user** making the search request

### 2. `bookings` (array)
- Contains **ALL active bookings** for this ride
- Shows **ALL passengers** who have booked (not just current user)
- Each booking includes full rider details:
  - `rider.name` - Full name
  - `rider.nickName` - Username
  - `rider.avatarUrl` - Profile picture
  - `rider.phone` - Phone number
  - `seatsBooked` - Number of seats they booked
  - `status` - Booking status

### 3. `availableSeats` (number)
- Remaining seats available to book
- Calculated as: `totalSeats - sum(all bookings.seatsBooked)`

## Example Scenarios

### Scenario 1: Multiple Passengers

**Ride Details:**
- Total Seats: 4
- Driver: John
- Passengers:
  - Alice booked 2 seats
  - Bob booked 1 seat
- Available: 1 seat

**When Alice searches:**
```json
{
  "hasActiveBooking": true,  // Alice already booked
  "bookings": [
    { "rider": { "name": "Alice" }, "seatsBooked": 2 },
    { "rider": { "name": "Bob" }, "seatsBooked": 1 }
  ],
  "availableSeats": 1
}
```

**When Bob searches:**
```json
{
  "hasActiveBooking": true,  // Bob already booked
  "bookings": [
    { "rider": { "name": "Alice" }, "seatsBooked": 2 },
    { "rider": { "name": "Bob" }, "seatsBooked": 1 }
  ],
  "availableSeats": 1
}
```

**When Charlie searches (new user):**
```json
{
  "hasActiveBooking": false,  // Charlie hasn't booked
  "bookings": [
    { "rider": { "name": "Alice" }, "seatsBooked": 2 },
    { "rider": { "name": "Bob" }, "seatsBooked": 1 }
  ],
  "availableSeats": 1
}
```

**When John (driver) searches:**
```json
{
  "hasActiveBooking": false,  // John is driver, not passenger
  "bookings": [
    { "rider": { "name": "Alice" }, "seatsBooked": 2 },
    { "rider": { "name": "Bob" }, "seatsBooked": 1 }
  ],
  "availableSeats": 1
}
```

### Scenario 2: No Bookings Yet

**Ride Details:**
- Total Seats: 4
- Driver: John
- Passengers: None
- Available: 4 seats

**When anyone searches:**
```json
{
  "hasActiveBooking": false,
  "bookings": [],  // Empty - no one booked yet
  "availableSeats": 4
}
```

## Frontend Usage Examples

### 1. Show All Passengers
```jsx
<div className="passengers-list">
  <h3>Passengers ({ride.bookings.length})</h3>
  {ride.bookings.map(booking => (
    <div key={booking.id} className="passenger">
      <img src={booking.rider.avatarUrl} alt={booking.rider.name} />
      <span>{booking.rider.name || booking.rider.nickName}</span>
      <span>{booking.seatsBooked} seats</span>
      {booking.passengerId === currentUserId && (
        <Badge>You</Badge>
      )}
    </div>
  ))}
</div>
```

### 2. Disable Booking Button if Already Booked
```jsx
<Button 
  disabled={ride.hasActiveBooking || ride.availableSeats === 0}
  onClick={() => bookRide(ride.id)}
>
  {ride.hasActiveBooking 
    ? "Already Booked" 
    : ride.availableSeats === 0 
    ? "Fully Booked" 
    : `Book (${ride.availableSeats} seats left)`
  }
</Button>
```

### 3. Show Seat Availability
```jsx
<div className="seat-info">
  <p>Total: {ride.totalSeats} seats</p>
  <p>Booked: {ride.totalSeats - ride.availableSeats} seats</p>
  <p>Available: {ride.availableSeats} seats</p>
  
  {ride.bookings.length > 0 && (
    <p>
      Traveling with {ride.bookings.length} other passenger
      {ride.bookings.length > 1 ? 's' : ''}
    </p>
  )}
</div>
```

### 4. Highlight Current User's Booking
```jsx
{ride.bookings.map(booking => {
  const isCurrentUser = booking.passengerId === currentUserId;
  
  return (
    <div 
      key={booking.id}
      className={isCurrentUser ? 'my-booking' : 'other-booking'}
    >
      <img src={booking.rider.avatarUrl} />
      <span>{booking.rider.name}</span>
      {isCurrentUser && <Badge color="blue">You</Badge>}
    </div>
  );
})}
```

## Active Booking Statuses

A booking is considered "active" and included in the response if its status is:
- `PAYMENT_PENDING`
- `DRIVER_PENDING`
- `CONFIRMED`
- `IN_PROGRESS`
- `COMPLETED`

Bookings with these statuses are **NOT** included:
- `CANCELLED`
- `PAYMENT_FAILED`

## Privacy Considerations

The API shows:
- ✅ Passenger names
- ✅ Passenger avatars
- ✅ Number of seats booked
- ❌ Passenger phone numbers (only shown to driver)
- ❌ Passenger email addresses
- ❌ Payment details

## Summary

✅ **All users see ALL passengers** who have booked the ride  
✅ **Each user knows if THEY have already booked** via `hasActiveBooking`  
✅ **Passenger details** (name, avatar) are visible to everyone  
✅ **Available seats** are calculated automatically  
✅ **Driver can see all passengers** in their ride  

This allows users to:
- See who they'll be traveling with
- Know if they've already booked
- Check seat availability
- Make informed booking decisions
