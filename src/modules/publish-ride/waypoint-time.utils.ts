/**
 * Calculate estimated arrival times for waypoints along a route.
 * Distributes total route duration evenly across all waypoints.
 * 
 * @param departureTime - Departure time in HH:MM format (e.g., "10:00")
 * @param routeDurationSeconds - Total route duration in seconds
 * @param waypointCount - Number of waypoints including origin and destination
 * @returns Array of arrival times in HH:MM format
 */
export const calculateWaypointArrivalTimes = (
    departureTime: string,
    routeDurationSeconds: number | null,
    waypointCount: number
): string[] => {
    const times: string[] = [];
    
    // Parse departure time to minutes
    const [hours, minutes] = departureTime.split(':').map(Number);
    const departureMinutes = hours * 60 + minutes;
    
    // First waypoint (origin) arrives at departure time
    times.push(departureTime);
    
    if (!routeDurationSeconds || waypointCount <= 1) {
        return times;
    }
    
    // Distribute time evenly across waypoints (simple approximation)
    const totalDurationMinutes = Math.ceil(routeDurationSeconds / 60);
    const minutesPerSegment = totalDurationMinutes / (waypointCount - 1);
    
    for (let i = 1; i < waypointCount; i++) {
        const arrivalMinutes = departureMinutes + Math.ceil(minutesPerSegment * i);
        const arrivalHours = Math.floor(arrivalMinutes / 60) % 24;
        const arrivalMins = arrivalMinutes % 60;
        
        times.push(`${String(arrivalHours).padStart(2, '0')}:${String(arrivalMins).padStart(2, '0')}`);
    }
    
    return times;
};

/**
 * Estimated arrival time at a point a given fraction of the way along the route.
 * Order-independent, unlike calculateWaypointArrivalTimes, which spaces waypoints evenly
 * by index — use this when the list is not in route order (e.g. towns listed before villages).
 *
 * @param departureTime - Departure time in HH:MM format
 * @param routeDurationSeconds - Total route duration in seconds
 * @param routeFraction - Distance travelled / total route distance, clamped to [0, 1]
 * @returns Arrival time in HH:MM format
 */
export const arrivalTimeAtRouteFraction = (
    departureTime: string,
    routeDurationSeconds: number,
    routeFraction: number,
): string => {
    const [hours, minutes] = departureTime.split(':').map(Number);
    const departureMinutes = hours * 60 + minutes;

    const fraction = Math.max(0, Math.min(1, routeFraction));
    const arrivalMinutes = departureMinutes + Math.ceil((routeDurationSeconds / 60) * fraction);

    const arrivalHours = Math.floor(arrivalMinutes / 60) % 24;
    const arrivalMins = arrivalMinutes % 60;

    return `${String(arrivalHours).padStart(2, '0')}:${String(arrivalMins).padStart(2, '0')}`;
};
