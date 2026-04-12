# Booking Price Calculation - Visual Examples

## Simple Pricing Examples

### Scenario: London to Manchester Ride

```
🚗 Ride Details:
├─ Origin: London
├─ Destination: Manchester
├─ Base Price Per Seat: £50
├─ Total Seats: 4
└─ Available Seats: 4
```

---

## Example 1: Single Passenger

```
👤 Booking Request:
{
  "rideId": "ride-123",
  "seatsBooked": 1
}

💰 Price Calculation:
£50 (per seat) × 1 (seat) = £50

✅ Result:
├─ Total Price: £50
├─ Seats Booked: 1
├─ Available Seats After: 3
└─ Payment Amount: £50
```

---

## Example 2: Two Passengers (Friends Traveling Together)

```
👥 Booking Request:
{
  "rideId": "ride-123",
  "seatsBooked": 2
}

💰 Price Calculation:
£50 (per seat) × 2 (seats) = £100

✅ Result:
├─ Total Price: £100
├─ Seats Booked: 2
├─ Available Seats After: 2
└─ Payment Amount: £100
```

---

## Example 3: Three Passengers (Small Group)

```
👥👤 Booking Request:
{
  "rideId": "ride-123",
  "seatsBooked": 3
}

💰 Price Calculation:
£50 (per seat) × 3 (seats) = £150

✅ Result:
├─ Total Price: £150
├─ Seats Booked: 3
├─ Available Seats After: 1
└─ Payment Amount: £150
```

---

## Example 4: Full Car (4 Passengers)

```
👥👥 Booking Request:
{
  "rideId": "ride-123",
  "seatsBooked": 4
}

💰 Price Calculation:
£50 (per seat) × 4 (seats) = £200

✅ Result:
├─ Total Price: £200
├─ Seats Booked: 4
├─ Available Seats After: 0 (FULL)
└─ Payment Amount: £200
```

---

## Advanced Example: Segment Pricing with Stopovers

### Scenario: Multi-Stop Journey

```
🚗 Ride with Stopovers:

London (Origin)
  │ £50/seat to Manchester
  ├─ Birmingham (Stopover 1)
  │    │ £30/seat to Manchester
  │    ├─ Liverpool (Stopover 2)
  │    │    │ £20/seat to Manchester
  │    │    └─ Manchester (Destination)
```

---

### Case A: Full Route (London → Manchester)

```
👥 Booking Request:
{
  "rideId": "ride-123",
  "seatsBooked": 2,
  "pickupWaypointId": null,
  "dropoffWaypointId": null
}

💰 Price Calculation:
£50 (full route per seat) × 2 (seats) = £100

✅ Result:
├─ Pickup: London
├─ Dropoff: Manchester
├─ Total Price: £100
└─ Distance: Full route
```

---

### Case B: Partial Route (Birmingham → Manchester)

```
👥 Booking Request:
{
  "rideId": "ride-123",
  "seatsBooked": 2,
  "pickupWaypointId": "stopover-birmingham-id",
  "dropoffWaypointId": null
}

💰 Price Calculation:
£30 (segment per seat) × 2 (seats) = £60

✅ Result:
├─ Pickup: Birmingham
├─ Dropoff: Manchester
├─ Total Price: £60 (cheaper!)
└─ Distance: Partial route
```

---

### Case C: Short Segment (Birmingham → Liverpool)

```
👥 Booking Request:
{
  "rideId": "ride-123",
  "seatsBooked": 3,
  "pickupWaypointId": "stopover-birmingham-id",
  "dropoffWaypointId": "stopover-liverpool-id"
}

💰 Price Calculation:
£20 (short segment per seat) × 3 (seats) = £60

✅ Result:
├─ Pickup: Birmingham
├─ Dropoff: Liverpool
├─ Total Price: £60
└─ Distance: Short segment
```

---

## Real-World Scenarios

### Scenario 1: Family Trip

```
👨‍👩‍👧‍👦 Family of 4 traveling together

Booking:
{
  "rideId": "london-to-edinburgh",
  "seatsBooked": 4
}

Ride Details:
├─ Base Price: £80/seat
├─ Total Seats: 4
└─ Available: 4

Calculation:
£80 × 4 = £320

Result:
✅ Total Price: £320
✅ Entire car booked
✅ Private ride for the family
```

---

### Scenario 2: Business Colleagues

```
👔👔 Two colleagues sharing a ride

Booking:
{
  "rideId": "manchester-to-london",
  "seatsBooked": 2
}

Ride Details:
├─ Base Price: £45/seat
├─ Total Seats: 4
└─ Available: 4

Calculation:
£45 × 2 = £90

Result:
✅ Total Price: £90
✅ £45 per person
✅ 2 seats still available for others
```

---

### Scenario 3: Solo Traveler

```
👤 One person traveling alone

Booking:
{
  "rideId": "birmingham-to-liverpool",
  "seatsBooked": 1
}

Ride Details:
├─ Base Price: £25/seat
├─ Total Seats: 3
└─ Available: 3

Calculation:
£25 × 1 = £25

Result:
✅ Total Price: £25
✅ Most economical option
✅ 2 seats still available
```

---

## Error Cases

### Case 1: Insufficient Seats

```
❌ Booking Request:
{
  "rideId": "ride-123",
  "seatsBooked": 5
}

Ride Status:
├─ Total Seats: 4
└─ Available Seats: 4

Result:
❌ ERROR: "INSUFFICIENT_SEATS"
└─ Cannot book more seats than available
```

---

### Case 2: Already Booked

```
❌ Booking Request:
{
  "rideId": "ride-123",
  "seatsBooked": 2
}

User Status:
└─ Already has active booking for this ride

Result:
❌ ERROR: "BOOKING_ALREADY_EXISTS"
└─ One booking per user per ride
```

---

### Case 3: Not Enough Seats Left

```
❌ Booking Request:
{
  "rideId": "ride-123",
  "seatsBooked": 3
}

Ride Status:
├─ Total Seats: 4
├─ Already Booked: 2
└─ Available Seats: 2

Result:
❌ ERROR: "INSUFFICIENT_SEATS"
└─ Only 2 seats available, cannot book 3
```

---

## Price Comparison Table

| Seats Booked | Price/Seat | Total Price | Savings vs Individual |
|--------------|------------|-------------|----------------------|
| 1            | £50        | £50         | -                    |
| 2            | £50        | £100        | £0 (same)            |
| 3            | £50        | £150        | £0 (same)            |
| 4            | £50        | £200        | £0 (same)            |

**Note:** Current system uses linear pricing (no bulk discounts). Each seat costs the same regardless of quantity.

---

## Payment Flow

### Step-by-Step for 2 Seats Booking

```
1️⃣ User Requests Booking
   ├─ Seats: 2
   └─ Ride: London → Manchester (£50/seat)

2️⃣ System Calculates Price
   ├─ £50 × 2 = £100
   └─ Validates seat availability

3️⃣ Booking Created
   ├─ Status: PAYMENT_PENDING
   ├─ Total Price: £100
   └─ Seats Reserved (not yet confirmed)

4️⃣ Payment Intent Created (Stripe)
   ├─ Amount: £100 (10000 pence)
   ├─ Currency: GBP
   └─ Client Secret returned

5️⃣ User Completes Payment
   ├─ Enters card details
   └─ Stripe processes payment

6️⃣ Webhook Confirms Payment
   ├─ Status: DRIVER_PENDING
   ├─ Payment Captured: £100
   └─ Driver notified

7️⃣ Driver Accepts
   ├─ Status: CONFIRMED
   ├─ Available Seats: -2
   └─ Booking complete ✅
```

---

## Database Storage

### Booking Record Example

```json
{
  "id": "booking-abc-123",
  "rideId": "ride-xyz-789",
  "passengerId": "user-def-456",
  "seatsBooked": 2,
  "totalPrice": 100,
  "paymentAmount": 100,
  "paymentCurrency": "GBP",
  "status": "CONFIRMED",
  "pickupWaypointId": null,
  "dropoffWaypointId": null,
  "stripePaymentIntentId": "pi_abc123xyz",
  "paymentCapturedAt": "2026-04-12T10:35:00.000Z",
  "createdAt": "2026-04-12T10:30:00.000Z",
  "updatedAt": "2026-04-12T10:35:00.000Z"
}
```

**Key Fields:**
- `seatsBooked`: 2 ✅
- `totalPrice`: 100 ✅ (£50 × 2)
- `paymentAmount`: 100 ✅ (matches totalPrice)
- `paymentCurrency`: "GBP" ✅

---

## Summary

### ✅ How It Works

1. **User selects seats** (1, 2, 3, or more)
2. **System calculates** `totalPrice = basePricePerSeat × seatsBooked`
3. **Validates availability** (enough seats?)
4. **Creates booking** with calculated price
5. **Processes payment** for total amount
6. **Decrements seats** after confirmation
7. **Stores everything** in database

### 🎯 Key Benefits

- ✅ **Automatic calculation** - No manual math needed
- ✅ **Fair pricing** - Each seat costs the same
- ✅ **Flexible** - Book 1 to max available seats
- ✅ **Transparent** - Price shown before payment
- ✅ **Accurate** - Stored in database for records
- ✅ **Integrated** - Works with payment system

### 💡 Use Cases

- Solo travelers (1 seat)
- Couples (2 seats)
- Small groups (3 seats)
- Families (4+ seats)
- Full car bookings (all seats)

**The system handles all scenarios automatically!** 🚀
