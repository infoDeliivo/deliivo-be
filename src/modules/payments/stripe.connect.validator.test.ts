/**
 * The custom onboarding form is the only place these fields are checked before they reach Stripe.
 * A rejection from Stripe arrives as an opaque account-level error, so anything we can catch here
 * is the difference between a field-level message and a dead end.
 */
import {
    connectBankAccountSchema,
    connectPersonalDetailsSchema,
    connectTermsSchema,
} from './stripe.connect.validator.js';

const validDetails = {
    firstName: 'John',
    lastName: 'Smith',
    email: 'john@example.com',
    phone: '+37255512345',
    dob: '2000-03-04',
    address: {
        line1: '12 Pikk',
        city: 'Tallinn',
        postalCode: '10123',
        country: 'EE',
    },
};

describe('connectPersonalDetailsSchema', () => {
    beforeEach(() => {
        process.env.STRIPE_CONNECT_COUNTRY = 'EE';
    });

    it('accepts a complete submission and splits the dob for Stripe', () => {
        const parsed = connectPersonalDetailsSchema.parse(validDetails);

        expect(parsed.dob).toEqual({ day: 4, month: 3, year: 2000 });
        expect(parsed.address.line2).toBeNull();
        expect(parsed.firstName).toBe('John');
    });

    it('defaults the address country to the configured payout country', () => {
        const { address, ...rest } = validDetails;
        const { country: _country, ...addressWithoutCountry } = address;

        const parsed = connectPersonalDetailsSchema.parse({
            ...rest,
            address: addressWithoutCountry,
        });

        expect(parsed.address.country).toBe('EE');
    });

    it('rejects an address outside the payout country', () => {
        const result = connectPersonalDetailsSchema.safeParse({
            ...validDetails,
            address: { ...validDetails.address, country: 'CA' },
        });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toContain('EE');
    });

    it('rejects a driver under Stripe’s minimum age', () => {
        const result = connectPersonalDetailsSchema.safeParse({
            ...validDetails,
            dob: '2018-07-11',
        });

        expect(result.success).toBe(false);
        expect(result.error?.issues[0].message).toContain('at least 13');
    });

    it('rejects a date that does not exist', () => {
        const result = connectPersonalDetailsSchema.safeParse({
            ...validDetails,
            dob: '2000-02-31',
        });

        expect(result.success).toBe(false);
    });

    it('rejects a phone that is not in international format', () => {
        const result = connectPersonalDetailsSchema.safeParse({
            ...validDetails,
            phone: '55512345',
        });

        expect(result.success).toBe(false);
    });

    it('treats an omitted phone as absent rather than invalid', () => {
        const { phone: _phone, ...withoutPhone } = validDetails;

        const parsed = connectPersonalDetailsSchema.parse(withoutPhone);

        expect(parsed.phone).toBeNull();
    });

    it('rejects blank required fields', () => {
        const result = connectPersonalDetailsSchema.safeParse({
            ...validDetails,
            address: { ...validDetails.address, city: '   ' },
        });

        expect(result.success).toBe(false);
    });
});

describe('connectBankAccountSchema', () => {
    it('accepts a Stripe.js bank account token', () => {
        expect(connectBankAccountSchema.parse({ token: 'btok_1abcDEF' })).toEqual({
            token: 'btok_1abcDEF',
        });
    });

    it('refuses raw bank details so they never reach this server', () => {
        expect(
            connectBankAccountSchema.safeParse({
                token: 'EE382200221020145685',
            }).success
        ).toBe(false);
        expect(
            connectBankAccountSchema.safeParse({
                accountNumber: 'EE382200221020145685',
                routingNumber: '22002',
            }).success
        ).toBe(false);
    });
});

describe('connectTermsSchema', () => {
    it('requires an explicit acceptance', () => {
        expect(connectTermsSchema.parse({ accepted: true })).toEqual({ accepted: true });
        expect(connectTermsSchema.safeParse({ accepted: false }).success).toBe(false);
        expect(connectTermsSchema.safeParse({}).success).toBe(false);
    });
});
