import { HttpStatus } from '../../utils/index.js';

export interface PublishErrorMapping {
    status: HttpStatus;
    message: string;
}

/**
 * Error codes thrown by the draft/publish services, mapped to the HTTP response the
 * client should see. Shared by every publish-ride controller so a code added here is
 * handled identically at draft creation and at publish — an unmapped eligibility code
 * would otherwise surface as a 500 at one entry point and a 403 at the other.
 */
export const PUBLISH_ERROR_MAP: Record<string, PublishErrorMapping> = {
    // ---- Driver eligibility ----
    DRIVER_NOT_VERIFIED: {
        status: HttpStatus.FORBIDDEN,
        message: 'Your driving licence must be verified before publishing a ride',
    },
    DL_IDENTITY_MISMATCH: {
        status: HttpStatus.FORBIDDEN,
        message:
            'The identity on your driving licence does not match your profile. Update your profile or re-submit your licence',
    },
    BANK_ACCOUNT_REQUIRED: {
        status: HttpStatus.FORBIDDEN,
        message: 'Connect a bank account to receive payouts before publishing a ride',
    },
    VEHICLE_REQUIRED: {
        status: HttpStatus.BAD_REQUEST,
        message: 'A vehicle is required before publishing a ride',
    },
    VEHICLE_NOT_VERIFIED: {
        status: HttpStatus.FORBIDDEN,
        message: 'Your vehicle is awaiting approval and cannot be used to publish a ride yet',
    },
    VEHICLE_REJECTED: {
        status: HttpStatus.FORBIDDEN,
        message: 'Your vehicle was rejected during review. Update it and resubmit before publishing',
    },
    DRIVER_NOT_ELIGIBLE: {
        status: HttpStatus.FORBIDDEN,
        message: 'You are not eligible to publish a ride yet',
    },

    // ---- Draft completeness ----
    DRAFT_NOT_FOUND: {
        status: HttpStatus.NOT_FOUND,
        message: 'Draft not found',
    },
    ORIGIN_AND_DESTINATION_REQUIRED: {
        status: HttpStatus.BAD_REQUEST,
        message: 'Origin and destination are required',
    },
    ROUTE_REQUIRED: {
        status: HttpStatus.BAD_REQUEST,
        message: 'Route is required before publishing',
    },
    SCHEDULE_REQUIRED: {
        status: HttpStatus.BAD_REQUEST,
        message: 'Schedule is required before publishing',
    },
    DEPARTURE_TOO_SOON: {
        status: HttpStatus.BAD_REQUEST,
        message: 'Departure must be at least 3 hours from now',
    },
    DRIVER_RIDE_TIME_CONFLICT: {
        status: HttpStatus.CONFLICT,
        message: 'You already have a ride scheduled at this time',
    },
    CAPACITY_AND_PRICING_REQUIRED: {
        status: HttpStatus.BAD_REQUEST,
        message: 'Seats and pricing are required before publishing',
    },
    MEETING_POINTS_REQUIRED: {
        status: HttpStatus.BAD_REQUEST,
        message: 'Add at least one pickup point and one drop-off point before publishing',
    },
    MEETING_POINT_OUTSIDE_ROUTE: {
        status: HttpStatus.BAD_REQUEST,
        message: 'Meeting points must be within the allowed distance of the selected route',
    },

    // ---- Route / location rules ----
    FEMALE_ONLY_NOT_ALLOWED: {
        status: HttpStatus.FORBIDDEN,
        message: 'Only female drivers can publish female-only rides',
    },
    NON_ROAD_ROUTE_NOT_ALLOWED: {
        status: HttpStatus.BAD_REQUEST,
        message: 'Routes that include ferry or water transport cannot be published',
    },
    LOCATION_OUTSIDE_BALTICS: {
        status: HttpStatus.BAD_REQUEST,
        message: 'Only locations in Estonia, Latvia, or Lithuania can be used to publish rides',
    },
    DESTINATION_OUTSIDE_EUROPE: {
        status: HttpStatus.BAD_REQUEST,
        message: 'Destinations must be in Europe for outbound rides from the Baltics',
    },
    LOCATION_COUNTRY_UNVERIFIED: {
        status: HttpStatus.BAD_REQUEST,
        message: 'Unable to verify the route countries. Select suggested locations and try again',
    },
};

/**
 * Resolve an error thrown by the publish-ride services into a response. Unknown codes
 * fall back to the supplied default so unexpected failures never leak internals.
 */
export const resolvePublishError = (
    error: unknown,
    fallbackMessage: string,
): PublishErrorMapping => {
    const code = error instanceof Error ? error.message : String(error);

    // The only code that carries its own message: the pricing service appends the allowed
    // range, which no static table can hold.
    if (code.startsWith('PRICE_OUT_OF_RANGE')) {
        return {
            status: HttpStatus.BAD_REQUEST,
            message:
                code.replace(/^PRICE_OUT_OF_RANGE:\s*/, '') ||
                'Selected price is outside the allowed pricing range',
        };
    }

    return (
        PUBLISH_ERROR_MAP[code] ?? {
            status: HttpStatus.INTERNAL_ERROR,
            message: fallbackMessage,
        }
    );
};
