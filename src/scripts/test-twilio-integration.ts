import dotenv from 'dotenv';
import twilio from 'twilio';
import { isValidE164PhoneNumber, maskPhoneNumber } from '../modules/sms/sms.config.js';

dotenv.config({ quiet: true });

const TWILIO_ACCOUNT_SID_REGEX = /^AC[a-zA-Z0-9]{32}$/;
const TWILIO_MESSAGING_SERVICE_SID_REGEX = /^MG[a-zA-Z0-9]{32}$/;

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
const testToNumber = process.env.TEST_SMS_TO;

const printHeader = (title: string) => {
  console.log(`\n=== ${title} ===`);
};

const validateSetup = () => {
  if (!accountSid || !authToken) {
    throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN in environment');
  }

  if (!TWILIO_ACCOUNT_SID_REGEX.test(accountSid)) {
    throw new Error('TWILIO_ACCOUNT_SID must be a valid AC-prefixed SID');
  }

  if (!fromNumber && !messagingServiceSid) {
    throw new Error('Set TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID in environment');
  }

  if (fromNumber && !isValidE164PhoneNumber(fromNumber)) {
    throw new Error('TWILIO_PHONE_NUMBER must be in E.164 format (example: +919876543210)');
  }

  if (messagingServiceSid && !TWILIO_MESSAGING_SERVICE_SID_REGEX.test(messagingServiceSid)) {
    throw new Error('TWILIO_MESSAGING_SERVICE_SID must be a valid MG-prefixed SID');
  }
};

const testTwilioAuth = async (client: ReturnType<typeof twilio>) => {
  printHeader('Twilio Auth Test');
  const account = await client.api.v2010.accounts(accountSid as string).fetch();
  console.log('PASS: Twilio credentials are valid');
  console.log(`Account status: ${account.status}`);
  console.log(`Account name: ${account.friendlyName}`);
};

const testSmsSend = async (client: ReturnType<typeof twilio>) => {
  printHeader('Twilio SMS Send Test');

  if (!testToNumber) {
    console.log('SKIP: TEST_SMS_TO is not set');
    console.log('Set TEST_SMS_TO to a real destination number in E.164 format to send a live SMS');
    return;
  }

  if (!isValidE164PhoneNumber(testToNumber)) {
    throw new Error('TEST_SMS_TO must be in E.164 format (example: +919876543210)');
  }

  if (fromNumber && testToNumber === fromNumber) {
    throw new Error("'To' and 'From' number cannot be the same. Set TEST_SMS_TO to a different number");
  }

  const body = `Carpooling Twilio integration test at ${new Date().toISOString()}`;

  const message = await client.messages.create({
    ...(messagingServiceSid ? { messagingServiceSid } : { from: fromNumber }),
    to: testToNumber,
    body,
  });

  console.log('PASS: SMS API call accepted by Twilio');
  console.log(`Message SID: ${message.sid}`);
  console.log(`Initial status: ${message.status}`);
  console.log(`To: ${maskPhoneNumber(testToNumber)}`);
};

const main = async () => {
  try {
    validateSetup();
    const client = twilio(accountSid as string, authToken as string);

    await testTwilioAuth(client);
    await testSmsSend(client);

    printHeader('Result');
    console.log('Twilio integration checks completed');
  } catch (error: any) {
    printHeader('Result');
    console.error('FAIL:', error?.message || error);
    process.exit(1);
  }
};

main();
