-- A4: Prevent available seats from going negative (atomic seat decrement guard)
ALTER TABLE "Ride" ADD CONSTRAINT chk_available_seats_non_negative CHECK ("availableSeats" >= 0);

-- A5: Store plaintext OTPs directly on the booking (not in notifications)
ALTER TABLE "RideBooking" ADD COLUMN IF NOT EXISTS "pickupOtp" TEXT;
ALTER TABLE "RideBooking" ADD COLUMN IF NOT EXISTS "dropOtp"   TEXT;
