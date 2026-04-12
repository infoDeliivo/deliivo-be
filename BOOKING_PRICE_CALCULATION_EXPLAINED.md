# Booking Price Calculation Feature

## Overview
This document explains how the booking price calculation works when users book multiple seats (2, 3+ people) and how the total price is calculated.

## Current Implementation

### Basic Price Calculation
```typescript
const totalPrice = basePricePerSeat * seatsBooked;
```

**Example:**
- Base price per seat: £25
- User books 3 seats
- Total price: £25 × 3 = £75

## Enhanced Price Calculation Features

### 1. Multi-Seat Booking Support

#### API Request
```json
POST /api/v1/bookings
{
  "rideId": "ride-123",
  "seatsBooked": 3,
  "segmentId": "optional-segment-token",
  "pickupWaypointId": null,
  "dropoffWaypointId": null,
  "luggageCount": 2,
  "notes": "Booking for 3 people"
}
```

#### Price Calculation Logic
```typescript
// Base calculation
const baseTotalPrice = basePricePerSeat * seatsBooked;

// Additional fees (if applicable)
const luggageFee = luggageCount * luggageFeePerItem; // Optional
const serviceFee = calculateServiceFee(baseTotalPrice); // Optional

// Final total
const totalPrice = baseTotalPrice + luggageFee + serviceFee;
```

### 2. Segment-Based Pricing

For rides with waypoints/stopovers, pricing can vary based on pickup/dropoff points:

```typescript
// If using specific waypoints
const segmentPrice = riderView.basePricePerSeat; // Already calculated for segment
const totalPrice = segmentPrice * seatsBooked;
```

**Example:**
- Full ride: London → Manchester (£30/seat)
- Segment: London → Birmingham (£20/seat)
- User books 2 seats for segment
- Total: £20 × 2 = £40

### 3. Price Breakdown Response

#### API Response Structure
```json
{
  "success": true,
  "message": "Booking created successfully",
  "data": {
    "id": "booking-456",
    "rideId": "ride-123",
    "seatsBooked": 3,
    "totalPrice": 75.00,
    "priceBreakdown": {
      "basePricePerSeat": 25.00,
      "seatsBooked": 3,
      "subtotal": 75.00,
      "luggageFee": 0.00,
      "serviceFee": 0.00,
      "totalPrice": 75.00,
      "currency": "GBP"
    },
    "ride": {
      "id": "ride-123",
      "originAddress": "London",
      "destinationAddress": "Manchester",
      "basePricePerSeat": 25.00
    },
    "segmentRide": {
      "originAddress": "London",
      "destinationAddress": "Birmingham",
      "basePricePerSeat": 20.00
    }
  }
}
```

## Implementation Details

### 1. Enhanced Booking Service

```typescript
// Calculate total price with breakdown
const calculateBookingPrice = (
  basePricePerSeat: number,
  seatsBooked: number,
  luggageCount: number = 0,
  currency: string = 'GBP'
) => {
  const subtotal = basePricePerSeat * seatsBooked;
  const luggageFee = luggageCount * 5.00; // £5 per luggage item
  const serviceFee = 0; // No service fee for now
  const totalPrice = subtotal + luggageFee + serviceFee;

  return {
    basePricePerSeat,
    seatsBooked,
    subtotal,
    luggageFee,
    serviceFee,
    totalPrice,
    currency,
  };
};
```

### 2. Validation Rules

```typescript
// Seat booking validation
if (seatsBooked < 1) {
  throw new Error('MINIMUM_ONE_SEAT_REQUIRED');
}

if (seatsBooked > ride.availableSeats) {
  throw new Error('INSUFFICIENT_SEATS');
}

if (seatsBooked > 4) {
  throw new Error('MAXIMUM_FOUR_SEATS_PER_BOOKING');
}
```

### 3. Database Schema

The booking table already supports:
- `seatsBooked: number` - Number of seats booked
- `totalPrice: number` - Total amount to pay
- `paymentAmount: number` - Amount charged
- `paymentCurrency: string` - Currency code

## Use Cases

### Case 1: Family Booking
```
Family of 4 books a ride:
- Base price: £20/seat
- Seats booked: 4
- Total: £20 × 4 = £80
```

### Case 2: Couple with Luggage
```
Couple books with 2 luggage items:
- Base price: £15/seat
- Seats booked: 2
- Luggage: 2 items × £5 = £10
- Total: (£15 × 2) + £10 = £40
```

### Case 3: Segment Booking
```
User books segment of longer ride:
- Full ride: London → Edinburgh (£50/seat)
- Segment: London → Birmingham (£25/seat)
- Seats booked: 3
- Total: £25 × 3 = £75
```

## API Endpoints

### 1. Create Booking with Price Calculation
```
POST /api/v1/bookings
```

### 2. Get Price Preview (Optional Enhancement)
```
POST /api/v1/bookings/price-preview
{
  "rideId": "ride-123",
  "seatsBooked": 3,
  "segmentId": "optional",
  "luggageCount": 1
}

Response:
{
  "priceBreakdown": {
    "basePricePerSeat": 25.00,
    "seatsBooked": 3,
    "subtotal": 75.00,
    "luggageFee": 5.00,
    "totalPrice": 80.00,
    "currency": "GBP"
  }
}
```

## Error Handling

### Insufficient Seats
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_SEATS",
    "message": "Only 2 seats available, but 3 requested",
    "details": {
      "availableSeats": 2,
      "requestedSeats": 3
    }
  }
}
```

### Maximum Seats Exceeded
```json
{
  "success": false,
  "error": {
    "code": "MAXIMUM_SEATS_EXCEEDED",
    "message": "Maximum 4 seats per booking",
    "details": {
      "maxSeatsPerBooking": 4,
      "requestedSeats": 5
    }
  }
}
```

## Benefits

1. **Clear Pricing**: Users see exactly how total price is calculated
2. **Multi-Passenger Support**: Easy booking for families/groups
3. **Flexible Pricing**: Support for segments, luggage fees, etc.
4. **Transparent Breakdown**: Detailed price breakdown in response
5. **Validation**: Proper seat availability checking
6. **Currency Support**: Multi-currency pricing

## Testing Scenarios

### Test 1: Single Seat
```bash
POST /api/v1/bookings
{
  "rideId": "ride-123",
  "seatsBooked": 1
}
# Expected: totalPrice = basePricePerSeat × 1
```

### Test 2: Multiple Seats
```bash
POST /api/v1/bookings
{
  "rideId": "ride-123",
  "seatsBooked": 3
}
# Expected: totalPrice = basePricePerSeat × 3
```

### Test 3: Insufficient Seats
```bash
POST /api/v1/bookings
{
  "rideId": "ride-with-2-seats",
  "seatsBooked": 3
}
# Expected: Error "INSUFFICIENT_SEATS"
```

### Test 4: Segment Pricing
```bash
POST /api/v1/bookings
{
  "rideId": "ride-123",
  "segmentId": "segment-token",
  "seatsBooked": 2
}
# Expected: totalPrice = segmentPrice × 2
```