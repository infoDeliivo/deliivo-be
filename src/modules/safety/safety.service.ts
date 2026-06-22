import { prisma } from '../../config/index.js';
import { createNotification } from '../notification/notification.service.js';

type CreateSosInput = {
  rideId?: string;
  bookingId?: string;
  role?: 'RIDER' | 'DRIVER';
  message?: string;
  lat?: number;
  lng?: number;
};

export const createEmergencySos = async (userId: string, input: CreateSosInput) => {
  const booking = input.bookingId
    ? await prisma.rideBooking.findUnique({
        where: { id: input.bookingId },
        include: {
          ride: {
            select: {
              id: true,
              driverId: true,
              originAddress: true,
              destinationAddress: true,
              departureDate: true,
              departureTime: true,
            },
          },
        },
      })
    : null;

  if (input.bookingId && !booking) {
    throw new Error('BOOKING_NOT_FOUND');
  }

  const rideId = input.rideId || booking?.rideId;
  const ride = booking?.ride || (rideId
    ? await prisma.ride.findUnique({
        where: { id: rideId },
        select: {
          id: true,
          driverId: true,
          originAddress: true,
          destinationAddress: true,
          departureDate: true,
          departureTime: true,
          bookings: {
            where: { passengerId: userId },
            select: { id: true },
            take: 1,
          },
        },
      })
    : null);

  if (!ride) {
    throw new Error('RIDE_NOT_FOUND');
  }

  const ridePassengerBookings = (ride as { bookings?: unknown }).bookings;
  const isDriver = ride.driverId === userId;
  const isPassenger = booking
    ? booking.passengerId === userId
    : Array.isArray(ridePassengerBookings) && ridePassengerBookings.length > 0;

  if (!isDriver && !isPassenger) {
    throw new Error('FORBIDDEN');
  }

  const role = input.role || (isDriver ? 'DRIVER' : 'RIDER');

  const alert = await prisma.emergencyAlert.create({
    data: {
      userId,
      rideId: ride.id,
      bookingId: booking?.id,
      role,
      message: input.message,
      lat: input.lat,
      lng: input.lng,
    },
    select: {
      id: true,
      userId: true,
      rideId: true,
      bookingId: true,
      role: true,
      status: true,
      message: true,
      lat: true,
      lng: true,
      createdAt: true,
    },
  });

  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true },
  });

  await Promise.all(admins.map((admin) =>
    createNotification({
      userId: admin.id,
      type: 'emergency_sos',
      title: 'Emergency SOS raised',
      body: `${role.toLowerCase()} raised SOS for ${ride.originAddress.split(',')[0]} to ${ride.destinationAddress.split(',')[0]}`,
      data: {
        alertId: alert.id,
        rideId: alert.rideId,
        bookingId: alert.bookingId,
        userId,
        role,
        lat: alert.lat,
        lng: alert.lng,
        createdAt: alert.createdAt.toISOString(),
      },
    })
  ));

  return alert;
};
