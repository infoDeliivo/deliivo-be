import fs from 'fs';
import path from 'path';

const STATE_FILE = path.join(process.cwd(), 'tests', 'e2e', '.test-state.json');

export interface AccountState {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
}

export interface RideState {
  id: string;
  originAddress: string;
  destinationAddress: string;
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
  departureDate: string;
  departureTime: string;
  basePricePerSeat: number;
  currency: string;
  availableSeats: number;
}

export interface TestState {
  runId: string;
  baseUrl: string;
  driverA: AccountState & { vehicleId: string | null };
  passengerA: AccountState;
  passengerB: AccountState;
  sharedRide: RideState | null;
}

export function writeState(state: TestState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export function readState(): TestState {
  if (!fs.existsSync(STATE_FILE)) {
    throw new Error(
      `Test state file not found at ${STATE_FILE}. ` +
      'Run the e2e test suite with globalSetup first.'
    );
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as TestState;
}

export function deleteStateFile(): void {
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
  }
}
