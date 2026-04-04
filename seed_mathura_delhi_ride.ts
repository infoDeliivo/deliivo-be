import { prisma } from './src/config/index.js';
import { searchRidesAdvanced } from './src/modules/search-ride/search-ride.service.js';
import { RideStatus, WaypointType } from '@prisma/client';
import type { EnhancedSearchRideQuery } from './src/modules/search-ride/search-ride.types.js';

const DRIVER_EMAIL = 'mathura.delhi.driver@example.com';
const DEPARTURE_DATE = new Date('2026-04-15');
const DEPARTURE_TIME = '08:30';

const MATHURA = {
    placeId: 'mathura_city_001',
    address: 'Mathura, Uttar Pradesh',
    lat: 27.4924,
    lng: 77.6737,
};

const DELHI = {
    placeId: 'new_delhi_city_001',
    address: 'Connaught Place, New Delhi, Delhi',
    lat: 28.6315,
    lng: 77.2167,
};

const WAYPOINTS = [
    {
        placeId: 'chhata_up_001',
        address: 'Chhata, Uttar Pradesh',
        lat: 27.7236,
        lng: 77.5089,
        waypointType: WaypointType.STOPOVER,
        orderIndex: 1,
        pricePerSeat: 160,
    },
    {
        placeId: 'kosi_kalan_up_001',
        address: 'Kosi Kalan, Uttar Pradesh',
        lat: 27.7932,
        lng: 77.4368,
        waypointType: WaypointType.STOPOVER,
        orderIndex: 2,
        pricePerSeat: 220,
    },
    {
        placeId: 'palwal_hr_001',
        address: 'Palwal, Haryana',
        lat: 28.1445,
        lng: 77.3255,
        waypointType: WaypointType.STOPOVER,
        orderIndex: 3,
        pricePerSeat: 360,
    },
    {
        placeId: 'ballabgarh_hr_001',
        address: 'Ballabgarh, Faridabad, Haryana',
        lat: 28.3444,
        lng: 77.3240,
        waypointType: WaypointType.STOPOVER,
        orderIndex: 4,
        pricePerSeat: 470,
    },
    {
        placeId: 'faridabad_hr_001',
        address: 'Faridabad, Haryana',
        lat: 28.4089,
        lng: 77.3178,
        waypointType: WaypointType.STOPOVER,
        orderIndex: 5,
        pricePerSeat: 520,
    },
    {
        placeId: 'badarpur_border_001',
        address: 'Badarpur Border, Delhi',
        lat: 28.4947,
        lng: 77.3032,
        waypointType: WaypointType.STOPOVER,
        orderIndex: 6,
        pricePerSeat: 590,
    },
];

const SEARCH_CASES = [
    {
        label: 'Mathura -> Delhi (full ride)',
        originLat: MATHURA.lat,
        originLng: MATHURA.lng,
        destinationLat: DELHI.lat,
        destinationLng: DELHI.lng,
    },
    {
        label: 'Kosi Kalan -> Faridabad (waypoint to waypoint)',
        originLat: 27.7932,
        originLng: 77.4368,
        destinationLat: 28.4089,
        destinationLng: 77.3178,
    },
    {
        label: 'Palwal -> Delhi (waypoint to destination)',
        originLat: 28.1445,
        originLng: 77.3255,
        destinationLat: DELHI.lat,
        destinationLng: DELHI.lng,
    },
];

const buildSearchQuery = (params: {
    originLat: number;
    originLng: number;
    destinationLat: number;
    destinationLng: number;
}): EnhancedSearchRideQuery => ({
    ...params,
    departureDate: DEPARTURE_DATE,
    radiusKm: 8,
    page: 1,
    limit: 20,
    sortBy: 'departure',
    sortOrder: 'asc',
    includeAlternates: true,
});

async function main() {
    const driver = await prisma.user.upsert({
        where: { email: DRIVER_EMAIL },
        update: {
            name: 'Mathura Delhi Test Driver',
            onboardingStatus: 'COMPLETED',
            isVerified: true,
        },
        create: {
            email: DRIVER_EMAIL,
            name: 'Mathura Delhi Test Driver',
            onboardingStatus: 'COMPLETED',
            isVerified: true,
        },
    });

    await prisma.ride.deleteMany({
        where: {
            driverId: driver.id,
            originAddress: MATHURA.address,
            destinationAddress: DELHI.address,
            departureDate: DEPARTURE_DATE,
        },
    });

    const ride = await prisma.ride.create({
        data: {
            driverId: driver.id,
            originPlaceId: MATHURA.placeId,
            originAddress: MATHURA.address,
            originLat: MATHURA.lat,
            originLng: MATHURA.lng,
            destinationPlaceId: DELHI.placeId,
            destinationAddress: DELHI.address,
            destinationLat: DELHI.lat,
            destinationLng: DELHI.lng,
            departureDate: DEPARTURE_DATE,
            departureTime: DEPARTURE_TIME,
            totalSeats: 4,
            availableSeats: 4,
            basePricePerSeat: 650,
            currency: 'INR',
            status: RideStatus.PUBLISHED,
            routeDistanceMeters: 183000,
            routeDurationSeconds: 12600,
            notes: 'Mathura to Delhi via major NH-19 stops',
            waypoints: {
                create: WAYPOINTS,
            },
        },
        include: {
            waypoints: { orderBy: { orderIndex: 'asc' } },
        },
    });

    console.log('\n✅ Ride created');
    console.log('Ride ID:', ride.id);
    console.log('Driver:', DRIVER_EMAIL);
    console.log('Route:', `${ride.originAddress} -> ${ride.destinationAddress}`);
    console.log('Waypoints:', ride.waypoints.length);

    console.log('\n🔎 Search validation');
    for (const searchCase of SEARCH_CASES) {
        const query = buildSearchQuery(searchCase);
        const result = await searchRidesAdvanced(query);
        const matchedRide = result.rides.find((r) => r.id === ride.id);

        if (!matchedRide) {
            console.log(`- ${searchCase.label}: NOT FOUND`);
            continue;
        }

        console.log(
            `- ${searchCase.label}: FOUND | matchType=${matchedRide.matchType} | price=${matchedRide.basePricePerSeat} ${matchedRide.currency}`,
        );
    }
}

main()
    .catch((error) => {
        console.error('❌ Failed to seed/search ride:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
