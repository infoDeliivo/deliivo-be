import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import * as controller from './vehicle.controller.js';
import {
  createVehicleSchema,
  updateVehicleDetailsSchema,
  draftLicenseSchema,
  draftVehicleDetailsSchema,
  draftImageSchema,
  getVehiclesQuerySchema,
} from './vehicle.validator.js';

const router = Router();

/* ================= DRAFT FLOW (Redis only) ================= */
router.post('/draft', validate({ body: draftLicenseSchema }), controller.createDraftWithLicense);
router.put('/draft/vehicle-details', validate({ body: draftVehicleDetailsSchema }), controller.updateDraftVehicleDetails);
// Document image is uploaded first via the presigned flow (target=vehicle_draft_document);
// the confirmed URL + documentType are posted here to attach it to the Redis draft.
router.post(
  '/draft/upload-document',
  validate({ body: draftImageSchema }),
  controller.uploadDraftDocument,
);
router.post('/draft/save', controller.saveVehicleFromDraft);

/* ================= EXISTING VEHICLE ROUTES ================= */
// Vehicle image + document uploads now use the presigned flow:
// POST /api/v1/uploads/presign then /confirm with target=vehicle_image | vehicle_document.
router.post('/', validate({ body: createVehicleSchema }), controller.createVehicle);
router.post('/:id', validate({ body: createVehicleSchema }), controller.createVehicle);
router.put(
  '/:id/update-details',
  validate({ body: updateVehicleDetailsSchema }),
  controller.updateVehicleDetails,
);

router.get('/', validate({ query: getVehiclesQuerySchema }), controller.getVehicle);
router.get('/:id', controller.getVehicle);
router.delete('/:id', controller.deleteVehicle);

export default router;
