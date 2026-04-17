# Proposal: Add Vehicle Details to Booking & Ride APIs

## Overview

Add vehicle information to booking and ride responses so passengers and drivers can see vehicle details (brand, model, color, year, image, etc.) in all relevant APIs.

---

## 🎯 Goals

1. **Passengers** can see vehicle details when viewing bookings
2. **Drivers** can see vehicle details in their published rides
3. **All users** can see vehicle details in ride search results
4. **Consistent** vehicle information across all APIs

---

## 📋 APIs to Update

### 1. Booking APIs (Passenger)

#### GET /api/v1/bookings (List all bookings)
**Current Response**:
```json
{
  "bookings": [
    {
      "id": "booking-uuid",
      "ride": {
        "driver": {
          "name": "John Driver"
        }
      }
    }
  ]
}
```

**Proposed Response**:
```json
{
  "bookings": [
    {
      "id": "booking-uuid",
      "ride": {
        "driver": {
          "name": "John Driver"
        },
        "vehicle": {
          "id": "vehicle-uuid",
          "brand": "Toyota",
          "model_name": "Camry",
          "model_num": "XV70",
          "type": "SEDAN",
          "color": "Silver",
          "year": 2023,
          "imageUrl": "https://example.com/vehicle.jpg",
          "isVerified": true
        }
      }
    }
  ]
}
```

#### GET /api/v1/bookings/:id (Get booking details)
**Add vehicle details** to the ride object in response.

---

### 2. Publish Ride APIs (Driver)

#### GET /api/v1/publish-ride (List driver's rides)
**Current Response**:
```json
{
  "rides": [
    {
      "id": "ride-uuid",
      "originAddress": "London, UK",
      "destinationAddress": "Manchester, UK",
      "vehicleId": "vehicle-uuid"
    }
  ]
}
```

**Proposed Response**:
```json
{
  "rides": [
    {
      "id": "ride-uuid",
      "originAddress": "London, UK",
      "destinationAddress": "Manchester, UK",
      "vehicleId": "vehicle-uuid",
      "vehicle": {
        "id": "vehicle-uuid",
        "brand": "Toyota",
        "model_name": "Camry",
        "model_num": "XV70",
        "type": "SEDAN",
        "color": "Silver",
        "year": 2023,
        "imageUrl": "https://example.com/vehicle.jpg",
        "isVerified": true
      }
    }
  ]
}
```

#### GET /api/v1/publish-ride/:id (Get ride details)
**Add vehicle details** to response.

---

### 3. Search Ride APIs (All Users)

#### GET /api/v1/search-rides (Search rides)
**Already has vehicle details** ✅ (implemented in search-ride service)

#### GET /api/v1/search-rides/advanced (Advanced search)
**Already has vehicle details** ✅ (implemented in search-ride service)

---

## 🏗️ Implementation Plan

### Phase 1: Update Type Definitions

**File**: `src/modules/ride-booking/ride-booking.types.ts`

```typescript
// Add vehicle interface
export interface VehicleInfo {
    id: string;
    brand: string | null;
    model_num: string | null;
    model_name: string | null;
    type: string | null;
    color: string | null;
    year: number | null;
    imageUrl: string | null;
    isVerified: boolean;
}

// Update BookingRideInfo to include vehicle
export interface BookingRideInfo {
    id: string;
    originAddress: string;
    destinationAddress: string;
    // ... other fields ...
    driver: {
        id: string;
        name: string | null;
        avatarUrl: string | null;
    };
    vehicle?: VehicleInfo | null;  // ← Add this
}
```

**File**: `src/modules/publish-ride/publish-ride.types.ts`

```typescript
// Add vehicle interface
export interface VehicleInfo {
    id: string;
    brand: string | null;
    model_num: string | null;
    model_name: string | null;
    type: string | null;
    color: string | null;
    year: number | null;
    imageUrl: string | null;
    isVerified: boolean;
}

// Update RideResponse to include vehicle
export interface RideResponse {
    id: string;
    driverId: string;
    vehicleId: string | null;
    // ... other fields ...
    vehicle?: VehicleInfo | null;  // ← Add this
}
```

---

### Phase 2: Update Booking Service

**File**: `src/modules/ride-booking/ride-booking.service.ts`

```typescript
// Add vehicle include to booking queries
const bookingInclude = {
    ride: {
        include: {
            driver: {
                select: {
                    id: true,
                    name: true,
                    avatarUrl: true,
                },
            },
            vehicle: {  // ← Add vehicle include
                select: {
                    id: true,
                    brand: true,
                    model_num: true,
                    model_name: true,
                    type: true,
                    color: true,
                    year: true,
                    imageUrl: true,
                    isVerified: true,
                },
            },
            waypoints: {
                orderBy: { orderIndex: 'asc' },
            },
        },
    },
};

// Update mapRideInfo function
const mapRideInfo = (ride: any): BookingRideInfo => ({
    id: ride.id,
    originAddress: ride.originAddress,
    destinationAddress: ride.destinationAddress,
    // ... other fields ...
    driver: {
        id: ride.driver.id,
        name: ride.driver.name,
        avatarUrl: ride.driver.avatarUrl,
    },
    vehicle: ride.vehicle ? {  // ← Add vehicle mapping
        id: ride.vehicle.id,
        brand: ride.vehicle.brand,
        model_num: ride.vehicle.model_num,
        model_name: ride.vehicle.model_name,
        type: ride.vehicle.type,
        color: ride.vehicle.color,
        year: ride.vehicle.year,
        imageUrl: ride.vehicle.imageUrl,
        isVerified: ride.vehicle.isVerified,
    } : null,
});

// Update getBookingById
export const getBookingById = async (
    passengerId: string,
    bookingId: string
): Promise<BookingResponse | null> => {
    const booking = await prisma.rideBooking.findFirst({
        where: {
            id: bookingId,
            passengerId,
        },
        include: bookingInclude,  // ← Uses updated include
    });

    // ... rest of the function
};

// Update listUserBookings
export const listUserBookings = async (
    passengerId: string,
    query: ListBookingsQuery
): Promise<BookingListResponse> => {
    const bookings = await prisma.rideBooking.findMany({
        where: whereClause,
        include: bookingInclude,  // ← Uses updated include
        skip,
        take: limit,
    });

    // ... rest of the function
};
```

---

### Phase 3: Update Publish Ride Service

**File**: `src/modules/publish-ride/publish-ride.service.ts`

```typescript
// Add vehicle include to ride queries
const rideInclude = {
    driver: {
        select: {
            id: true,
            name: true,
            avatarUrl: true,
        },
    },
    vehicle: {  // ← Add vehicle include
        select: {
            id: true,
            brand: true,
            model_num: true,
            model_name: true,
            type: true,
            color: true,
            year: true,
            imageUrl: true,
            isVerified: true,
        },
    },
    waypoints: {
        orderBy: { orderIndex: 'asc' },
    },
    bookings: {
        where: { status: { in: activeBookingStatuses } },
        include: {
            passenger: {
                select: {
                    id: true,
                    name: true,
                    nickName: true,
                    phone: true,
                    avatarUrl: true,
                },
            },
        },
    },
};

// Update getUserRides
export const getUserRides = async (
    userId: string,
    query: ListRidesQuery
): Promise<ListRidesResponse> => {
    const rides = await prisma.ride.findMany({
        where: whereClause,
        include: rideInclude,  // ← Uses updated include
        skip,
        take: limit,
    });

    // Map rides with vehicle details
    const ridesWithDetails = rides.map(ride => ({
        ...ride,
        vehicle: ride.vehicle ? {
            id: ride.vehicle.id,
            brand: ride.vehicle.brand,
            model_num: ride.vehicle.model_num,
            model_name: ride.vehicle.model_name,
            type: ride.vehicle.type,
            color: ride.vehicle.color,
            year: ride.vehicle.year,
            imageUrl: ride.vehicle.imageUrl,
            isVerified: ride.vehicle.isVerified,
        } : null,
    }));

    return {
        rides: ridesWithDetails,
        pagination: { page, limit, total, totalPages },
    };
};

// Update getRideById
export const getRideById = async (
    userId: string,
    rideId: string
): Promise<RideResponse | null> => {
    const ride = await prisma.ride.findFirst({
        where: {
            id: rideId,
            driverId: userId,
        },
        include: rideInclude,  // ← Uses updated include
    });

    if (!ride) return null;

    return {
        ...ride,
        vehicle: ride.vehicle ? {
            id: ride.vehicle.id,
            brand: ride.vehicle.brand,
            model_num: ride.vehicle.model_num,
            model_name: ride.vehicle.model_name,
            type: ride.vehicle.type,
            color: ride.vehicle.color,
            year: ride.vehicle.year,
            imageUrl: ride.vehicle.imageUrl,
            isVerified: ride.vehicle.isVerified,
        } : null,
    };
};
```

---

## 📊 Response Examples

### Example 1: Get Booking Details

**Request**:
```bash
GET /api/v1/bookings/booking-123
Authorization: Bearer {passenger_token}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "id": "booking-123",
    "rideId": "ride-456",
    "seatsBooked": 2,
    "totalPrice": 50.00,
    "status": "CONFIRMED",
    "pickupOtp": "1234",
    "dropOtp": "5678",
    
    "ride": {
      "id": "ride-456",
      "originAddress": "London, UK",
      "destinationAddress": "Manchester, UK",
      "departureDate": "2026-04-20",
      "departureTime": "09:00",
      
      "driver": {
        "id": "driver-789",
        "name": "John Driver",
        "avatarUrl": "https://example.com/avatar.jpg"
      },
      
      "vehicle": {
        "id": "vehicle-101",
        "brand": "Toyota",
        "model_name": "Camry",
        "model_num": "XV70",
        "type": "SEDAN",
        "color": "Silver",
        "year": 2023,
        "imageUrl": "https://example.com/vehicle.jpg",
        "isVerified": true
      }
    }
  }
}
```

### Example 2: List Driver's Rides

**Request**:
```bash
GET /api/v1/publish-ride?page=1&limit=10
Authorization: Bearer {driver_token}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "rides": [
      {
        "id": "ride-456",
        "originAddress": "London, UK",
        "destinationAddress": "Manchester, UK",
        "departureDate": "2026-04-20",
        "departureTime": "09:00",
        "totalSeats": 3,
        "availableSeats": 1,
        "basePricePerSeat": 25.00,
        "status": "PUBLISHED",
        "vehicleId": "vehicle-101",
        
        "vehicle": {
          "id": "vehicle-101",
          "brand": "Toyota",
          "model_name": "Camry",
          "model_num": "XV70",
          "type": "SEDAN",
          "color": "Silver",
          "year": 2023,
          "imageUrl": "https://example.com/vehicle.jpg",
          "isVerified": true
        },
        
        "bookings": [
          {
            "id": "booking-123",
            "seatsBooked": 2,
            "rider": {
              "name": "Jane Passenger"
            }
          }
        ]
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 5,
      "totalPages": 1
    }
  }
}
```

---

## 🎨 UI Benefits

### For Passengers

**Booking List Screen**:
```
┌─────────────────────────────────────────┐
│  MY BOOKINGS                            │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │ 🚗 London → Manchester            │ │
│  │ Toyota Camry (Silver, 2023)       │ │
│  │ Driver: John                      │ │
│  │ Apr 20, 09:00 • £50               │ │
│  │ [View Details]                    │ │
│  └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

**Booking Details Screen**:
```
┌─────────────────────────────────────────┐
│  BOOKING DETAILS                        │
│                                         │
│  Vehicle Information:                   │
│  ┌───────────────────────────────────┐ │
│  │ [Vehicle Image]                   │ │
│  │ Toyota Camry XV70                 │ │
│  │ Silver • 2023 • Sedan             │ │
│  │ ✓ Verified                        │ │
│  └───────────────────────────────────┘ │
│                                         │
│  Driver: John Driver                    │
│  Pickup OTP: 1234                       │
│  Drop OTP: 5678                         │
└─────────────────────────────────────────┘
```

### For Drivers

**My Rides Screen**:
```
┌─────────────────────────────────────────┐
│  MY PUBLISHED RIDES                     │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │ London → Manchester               │ │
│  │ Vehicle: Toyota Camry (Silver)    │ │
│  │ Apr 20, 09:00                     │ │
│  │ 2 bookings • 1 seat available     │ │
│  │ [View Details]                    │ │
│  └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

---

## ✅ Benefits

1. **Better User Experience**: Passengers know what vehicle to expect
2. **Trust & Safety**: Vehicle verification status visible
3. **Easy Identification**: Passengers can identify vehicle at pickup
4. **Consistent Data**: Same vehicle info across all APIs
5. **No Extra API Calls**: Vehicle details included in response

---

## 🔧 Implementation Steps

### Step 1: Update Type Definitions
- Add `VehicleInfo` interface
- Update `BookingRideInfo` interface
- Update `RideResponse` interface

### Step 2: Update Booking Service
- Add vehicle include to Prisma queries
- Update `mapRideInfo` function
- Update `getBookingById` function
- Update `listUserBookings` function

### Step 3: Update Publish Ride Service
- Add vehicle include to Prisma queries
- Update `getUserRides` function
- Update `getRideById` function

### Step 4: Update OpenAPI Documentation
- Add vehicle object to booking response schema
- Add vehicle object to ride response schema
- Add examples with vehicle details

### Step 5: Test
- Test booking APIs with vehicle details
- Test publish ride APIs with vehicle details
- Verify vehicle details are correct
- Test with rides that have no vehicle

---

## 📝 Notes

### Handling Missing Vehicles

If a ride doesn't have a vehicle assigned:
```json
{
  "vehicleId": null,
  "vehicle": null
}
```

### Fallback Vehicle

If ride has no vehicle but driver has vehicles, use driver's first vehicle:
```typescript
const vehicle = ride.vehicle || driver.vehicles[0] || null;
```

---

## 🎯 Summary

**What**: Add vehicle details to booking and ride APIs

**Why**: Better UX, easier vehicle identification, consistent data

**Where**: 
- GET /api/v1/bookings (list)
- GET /api/v1/bookings/:id (details)
- GET /api/v1/publish-ride (list)
- GET /api/v1/publish-ride/:id (details)

**How**: Include vehicle in Prisma queries and map to response

**Effort**: ~2-3 hours implementation + testing

**Impact**: High - Improves passenger and driver experience significantly

---

**Ready to implement?** ✅
