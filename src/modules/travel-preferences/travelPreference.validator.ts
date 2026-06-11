import { z } from 'zod';
import { Chattiness, PetsPreference } from './travelPreference.types.js';

export const travelPreferenceSchema = z.object({
  chattiness: z.nativeEnum(Chattiness).optional().describe('Chattiness preference'),
  pets: z.nativeEnum(PetsPreference).optional().describe('Pets preference'),
}).refine(
  (data) => data.chattiness !== undefined || data.pets !== undefined,
  {
    message: 'At least one preference (chattiness or pets) must be provided',
  }
);
