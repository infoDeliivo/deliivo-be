import { noShowAvailableAt } from './no-show-window.js';

describe('noShowAvailableAt', () => {
    const originalSimulation = process.env.ALLOW_RIDE_SIMULATION;

    afterEach(() => {
        process.env.ALLOW_RIDE_SIMULATION = originalSimulation;
    });

    it('is 10 minutes after the driver arrived', () => {
        delete process.env.ALLOW_RIDE_SIMULATION;
        const arrived = new Date('2026-10-07T09:00:00.000Z');
        expect(noShowAvailableAt(arrived)).toEqual(new Date('2026-10-07T09:10:00.000Z'));
    });

    it('is null when the driver has not arrived yet', () => {
        expect(noShowAvailableAt(null)).toBeNull();
    });

    it('is immediate under local ride simulation', () => {
        process.env.ALLOW_RIDE_SIMULATION = 'true';
        const arrived = new Date('2026-10-07T09:00:00.000Z');
        expect(noShowAvailableAt(arrived)).toEqual(arrived);
    });
});
