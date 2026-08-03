export const formatBookingReference = (bookingId: string): string => {
    const compactId = bookingId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return `DLV-${compactId.slice(-6)}`;
};
