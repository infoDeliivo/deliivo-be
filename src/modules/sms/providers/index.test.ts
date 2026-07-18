import { getSmsProvider } from './index.js';

describe('getSmsProvider', () => {
  const original = process.env.SMS_PROVIDER;
  afterEach(() => {
    if (original === undefined) delete process.env.SMS_PROVIDER;
    else process.env.SMS_PROVIDER = original;
  });

  it('defaults to twilio when SMS_PROVIDER is unset', () => {
    delete process.env.SMS_PROVIDER;
    expect(getSmsProvider().name).toBe('twilio');
  });

  it('returns the messente provider when SMS_PROVIDER=messente', () => {
    process.env.SMS_PROVIDER = 'messente';
    expect(getSmsProvider().name).toBe('messente');
  });

  it('is case/space-insensitive', () => {
    process.env.SMS_PROVIDER = '  Twilio ';
    expect(getSmsProvider().name).toBe('twilio');
  });

  it('throws on an unknown provider', () => {
    process.env.SMS_PROVIDER = 'nexmo';
    expect(() => getSmsProvider()).toThrow(/SMS_PROVIDER/);
  });
});
