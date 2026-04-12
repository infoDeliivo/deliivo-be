# Real-Time Booking Synchronization Analysis

## Overview
This document explains how the carpooling application handles real-time synchronization when a driver publishes a ride and riders book it.

## Current Implementation Status

### ❌ **Issue Found: GET /api/v1/publish-ride/{id} Does NOT Include Bookings**

The current implementation has a **limitation** - when a driver checks their published ride using `GET /api/v1/publish-ride/{id}`, the endpoint **does not include bookings** in the response.

### Code Evidence

**File:** `src/modules/publish-ride/publish-ride.service.ts`

```typescript
export const getRideById = async (driverId: string, rideId: string) => {
    const ride = await prisma.ride.findFirst({
        where: { id: rideId, driverId },
        include: { waypoints: { orderBy: { orderIndex: 'asc' } } },  // ❌ No bookings included
    });

    if (!ride) {
        throw new Error('RIDE_NOT_FOUND');
    }

    return ride;
};
```

**Problem:** The `include` clause only fetches `waypoints`, but **NOT** `bookings`. This means:
- ✅ Driver can see ride details (origin, destination, waypoints, pricing)
- ❌ Driver **CANNOT** see who has booked the ride
- ❌ Driver **CANNOT** see booking statuses in real-time
- ❌ No automatic sync when riders book

---

## How Real-Time Notifications Work (For Bookings)

### ✅ **Real-Time System IS Implemented**

The application **does have** a real-time notification system using:
1. **WebSocket (Socket.IO)** - For online users
2. **Push Notifications (FCM/APNs)** - For offline users

**File:** `src/modules/notification/notification.service.ts`

```typescript
export const createNotification = async (input: CreateNotificationInput) => {
    // ... create notification in DB ...

    // Try real-time delivery via WebSocket
    let deliveredViaSocket = false;
    try {
        const { getIO, getUserSocketIds } = await import('../../socket/index.js');
        const io = getIO();
        if (io) {
            const socketIds = getUserSocketIds(userId);

            if (socketIds.length > 0) {
                // User is ONLINE — deliver via WebSocket
                const payload = {
                    type: 'notification.new',
                    data: {
                        id: notification.id,
                        title: notification.title,
                        body: notification.body,
                        notificationType: notification.type,
                        data: normalizedData,
                        preview: true,
                        createdAt: notification.createdAt,
                    },
                };

                socketIds.forEach((sid: string) => {
                    io.to(sid).emit('notification:new', payload);
                });

                deliveredViaSocket = true;
            }
        }
    } catch (error) {
        logger.error('WebSocket notification emit error:', error);
    }

    // User is OFFLINE — send push notification via FCM/APNs
    if (!deliveredViaSocket) {
        await sendPushToUser(userId, { title, body, data });
    }
};
```

### When Rider Books a Ride

**File:** `src/modules/ride-booking/ride-booking.service.ts`

```typescript
export const createBooking = async (passengerId: string, input: CreateBookingInput) => {
    // ... create booking in database ...
    
    // Send notification to driver
    await createNotification({
        userId: bookingSeed.ride.driverId,  // ✅ Driver gets notified
        type: DRIVER_DECISION_NOTIFICATION_TYPE,
        title: 'New ride request',
        body: `${passengerName} wants ${originAddress} to ${destinationAddress}`,
        data: {
            bookingId: bookingSeed.booking.id,
            rideId: bookingSeed.booking.rideId,
            passengerName,
            originAddress,
            destinationAddress,
            seatsBooked: String(bookingSeed.booking.seatsBooked),
            totalPrice: String(bookingSeed.booking.totalPrice),
            currency: bookingSeed.booking.paymentCurrency,
            deepLink: `app://driver/booking-request/${bookingSeed.booking.id}`,
        },
    });
};
```

---

## What Works vs What Doesn't

### ✅ **What Works:**
1. **Driver gets real-time notification** when a rider books their ride
2. **WebSocket connection** for online users
3. **Push notifications** for offline users
4. **Notification includes booking details** (passenger name, route, price)
5. **Deep link** to booking request screen

### ❌ **What Doesn't Work:**
1. **GET /api/v1/publish-ride/{id}** does NOT show bookings
2. **No automatic sync** of booking list when viewing ride details
3. **Driver must rely on notifications** - cannot see all bookings by refreshing ride details
4. **No WebSocket event** specifically for ride booking updates

---

## Comparison with Search Ride Endpoint

The **search ride** endpoint (`/api/v1/search-rides`) **DOES include bookings**:

**File:** `src/modules/search-ride/search-ride.service.ts`

```typescript
const bookingWithRiderInclude = {
  where: { status: { in: activeBookingStatuses } },
  orderBy: { createdAt: 'desc' as const },
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
};

// Used in ride queries:
const ride = await prisma.ride.findFirst({
    include: {
        waypoints: { orderBy: { orderIndex: 'asc' } },
        bookings: bookingWithRiderInclude,  // ✅ Bookings included here
    },
});
```

---

## Recommended Solution

To enable real-time booking sync when driver checks their ride, you need to:

### 1. **Update `getRideById` to Include Bookings**

**File:** `src/modules/publish-ride/publish-ride.service.ts`

```typescript
export const getRideById = async (driverId: string, rideId: string) => {
    const ride = await prisma.ride.findFirst({
        where: { id: rideId, driverId },
        include: { 
            waypoints: { orderBy: { orderIndex: 'asc' } },
            bookings: {  // ✅ Add this
                where: { 
                    status: { 
                        in: [
                            'PAYMENT_PENDING',
                            'DRIVER_PENDING', 
                            'CONFIRMED',
                            'IN_PROGRESS'
                        ] 
                    } 
                },
                orderBy: { createdAt: 'desc' },
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
        },
    });

    if (!ride) {
        throw new Error('RIDE_NOT_FOUND');
    }

    return ride;
};
```

### 2. **Add WebSocket Event for Booking Updates (Optional)**

**File:** `src/modules/ride-booking/ride-booking.service.ts`

```typescript
export const createBooking = async (passengerId: string, input: CreateBookingInput) => {
    // ... existing code ...
    
    // Send notification to driver
    await createNotification({ ... });
    
    // ✅ Add WebSocket event for real-time sync
    try {
        const { getIO, getUserSocketIds } = await import('../../socket/index.js');
        const io = getIO();
        if (io) {
            const driverSocketIds = getUserSocketIds(bookingSeed.ride.driverId);
            
            if (driverSocketIds.length > 0) {
                const payload = {
                    type: 'ride.booking.new',
                    data: {
                        rideId: bookingSeed.booking.rideId,
                        bookingId: bookingSeed.booking.id,
                        passenger: {
                            id: passengerId,
                            name: bookingSeed.passenger?.name,
                            avatarUrl: bookingSeed.passenger?.avatarUrl,
                        },
                        seatsBooked: bookingSeed.booking.seatsBooked,
                        totalPrice: bookingSeed.booking.totalPrice,
                        status: bookingSeed.booking.status,
                    },
                };
                
                driverSocketIds.forEach((sid: string) => {
                    io.to(sid).emit('ride:booking:new', payload);
                });
            }
        }
    } catch (error) {
        logger.error('WebSocket ride booking emit error:', error);
    }
};
```

### 3. **Client-Side Implementation**

The mobile/web app should:

```typescript
// Connect to WebSocket
socket.on('ride:booking:new', (payload) => {
    // Update local ride state with new booking
    updateRideBookings(payload.rideId, payload.data);
    
    // Show notification
    showNotification(`New booking from ${payload.data.passenger.name}`);
});

// When viewing ride details, poll or refresh
const refreshRideDetails = async (rideId: string) => {
    const response = await fetch(`/api/v1/publish-ride/${rideId}`);
    const ride = await response.json();
    // Now includes bookings array
    displayBookings(ride.bookings);
};
```

---

## Summary

**Current State:**
- ✅ Real-time **notifications** work via WebSocket/Push
- ❌ Real-time **booking list sync** does NOT work
- ❌ Driver must rely on notifications, cannot see full booking list in ride details

**To Fix:**
1. Add `bookings` include to `getRideById` query
2. (Optional) Add WebSocket event `ride:booking:new` for instant updates
3. Update client to listen for WebSocket events and refresh ride details

**Impact:**
- Drivers will see all active bookings when checking ride details
- Real-time sync will work when driver is viewing the ride
- Better user experience with instant updates
