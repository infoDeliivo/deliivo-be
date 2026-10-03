const RIDE_TIME_ZONE = 'Europe/Tallinn';

const rideTimeFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: RIDE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
});

const getRideTimeParts = (date: Date) => {
    const parts = rideTimeFormatter.formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || '0');

    return {
        year: value('year'),
        month: value('month'),
        day: value('day'),
        hour: value('hour'),
        minute: value('minute'),
        second: value('second'),
    };
};

export const getRideTimeOffsetMs = (date: Date): number => {
    const zoned = getRideTimeParts(date);
    return Date.UTC(
        zoned.year,
        zoned.month - 1,
        zoned.day,
        zoned.hour,
        zoned.minute,
        zoned.second,
    ) - date.getTime();
};

export const combineDepartureDateTimeInRideTimezone = (departureDate: Date, departureTime: string): Date => {
    const [hoursRaw, minutesRaw] = departureTime.split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);

    if (
        !Number.isInteger(hours) ||
        !Number.isInteger(minutes) ||
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59
    ) {
        throw new Error('INVALID_RIDE_DEPARTURE_TIME');
    }

    const rideDate = getRideTimeParts(departureDate);
    const utcGuess = Date.UTC(
        rideDate.year,
        rideDate.month - 1,
        rideDate.day,
        hours,
        minutes,
        0,
        0,
    );
    const offsetMs = getRideTimeOffsetMs(new Date(utcGuess));
    return new Date(utcGuess - offsetMs);
};
