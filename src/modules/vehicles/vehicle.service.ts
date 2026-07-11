import { prisma } from '../../config/index.js';
import { VehicleType, DocumentType, Prisma } from '@prisma/client';
import { VehicleDocumentResponse } from './vehicle.types.js';

type UpdateVehicleDetailsInput = {
  brand: string;
  model_num: string;
  model_name: string;
  type: VehicleType;
  color: string;
  year: number;
};

const MAX_VEHICLES_PER_USER = 1;

/* ================= CREATE VEHICLE ================= */
export const createVehicle = async (
  userId: string,
  licenseCountry: string,
  licenseNumber: string,
) => {
  const count = await prisma.vehicle.count({
    where: {
      userId,
      deletedAt: null,
    },
  });

  if (count >= MAX_VEHICLES_PER_USER) {
    throw new Error('MAX_VEHICLE_LIMIT_REACHED');
  }

  return prisma.vehicle.create({
    data: {
      userId,
      licenseCountry,
      licenseNumber,
    },
  });
};

/* ================= UPDATE LICENSE DETAILS ================= */
export const updateCreateVehicle = async (
  userId: string,
  vehicleId: string,
  licenseCountry: string,
  licenseNumber: string,
) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: {
      id: vehicleId,
      userId,
      deletedAt: null,
    },
  });

  if (!vehicle) {
    throw new Error('VEHICLE_NOT_FOUND');
  }

  return prisma.vehicle.update({
    where: { id: vehicleId },
    data: { licenseCountry, licenseNumber },
  });
};

/* ================= UPDATE VEHICLE DETAILS ================= */
export const updateVehicleDetailService = async (
  userId: string,
  vehicleId: string,
  update: UpdateVehicleDetailsInput,
) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: {
      id: vehicleId,
      userId,
      deletedAt: null,
    },
  });

  if (!vehicle) {
    throw new Error('VEHICLE_NOT_FOUND');
  }

  return prisma.vehicle.update({
    where: { id: vehicleId },
    data: {
      brand: update.brand,
      model_num: update.model_num,
      model_name: update.model_name,
      type: update.type,
      color: update.color,
      year: update.year,
    },
  });
};

/* ================= UPDATE GENERIC (IMAGE ETC.) ================= */
export const updateVehicle = async (
  userId: string,
  vehicleId: string,
  update: Record<string, any>,
) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: {
      id: vehicleId,
      userId,
      deletedAt: null,
    },
  });

  if (!vehicle) {
    return { success: false, message: 'Vehicle not found' }
  }
  const previousImageKey = vehicle.imageKey ?? undefined;
  const data = await prisma.vehicle.update({
    where: { id: vehicleId },
    data: update,
  })

  return { success: true, message: 'Vehicle updated successfully', data, previousImageKey };
};

/* ================= CLEAR VEHICLE IMAGE ================= */
export const clearVehicleImage = async (userId: string, vehicleId: string) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, userId, deletedAt: null },
  });

  if (!vehicle) {
    return { success: false, message: 'Vehicle not found' };
  }

  const previousImageKey = vehicle.imageKey ?? undefined;
  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: { imageUrl: null, imageKey: null },
  });

  return { success: true, message: 'Vehicle image removed', previousImageKey };
};

/* ================= DELETE VEHICLE DOCUMENT (ownership-scoped) ================= */
export const deleteVehicleDocument = async (
  userId: string,
  vehicleId: string,
  imageKey: string,
) => {
  const doc = await findVehicleDocumentByKey(userId, vehicleId, imageKey);
  if (!doc) return null;

  await prisma.vehicleDocument.delete({ where: { id: doc.id } });
  return doc;
};

/* ================= OWNERSHIP CHECK ================= */
export const userOwnsVehicle = async (userId: string, vehicleId: string): Promise<boolean> => {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, userId, deletedAt: null },
    select: { id: true },
  });
  return !!vehicle;
};

/* ================= ADD VEHICLE DOCUMENT (presigned confirm) ================= */
export const addVehicleDocument = async (
  userId: string,
  vehicleId: string,
  input: { imageKey: string; imageUrl?: string; documentType: DocumentType },
) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, userId, deletedAt: null },
    select: { id: true },
  });

  if (!vehicle) {
    throw new Error('VEHICLE_NOT_FOUND');
  }

  return prisma.vehicleDocument.create({
    data: {
      vehicleId,
      imageKey: input.imageKey,
      image: input.imageUrl,
      documentType: input.documentType,
    },
  });
};

/* ================= FIND VEHICLE DOCUMENT BY KEY (ownership-scoped read) ================= */
export const findVehicleDocumentByKey = async (
  userId: string,
  vehicleId: string,
  imageKey: string,
) => {
  return prisma.vehicleDocument.findFirst({
    where: {
      imageKey,
      vehicleId,
      vehicle: { userId, deletedAt: null },
    },
  });
};

/* ================= GET VEHICLE ================= */

// Only the document fields the client needs; keeps raw S3 keys out of the response
// except as `previewKey`, which is fed to GET /uploads/read for a signed view URL.
const vehicleDocumentSelect = {
  id: true,
  imageKey: true,
  image: true,
  documentType: true,
  createdAt: true,
} satisfies Prisma.VehicleDocumentSelect;

type VehicleWithDocuments = Prisma.VehicleGetPayload<{
  include: { documents: { select: typeof vehicleDocumentSelect } };
}>;

const mapVehicleDocument = (
  doc: VehicleWithDocuments['documents'][number],
): VehicleDocumentResponse => ({
  id: doc.id,
  documentType: doc.documentType,
  previewKey: doc.imageKey ?? null,
  image: doc.image ?? null,
  createdAt: doc.createdAt,
});

const mapVehicle = (vehicle: VehicleWithDocuments) => {
  const { documents, ...rest } = vehicle;
  return { ...rest, documents: documents.map(mapVehicleDocument) };
};

export const getVehicle = async (
  userId: string,
  vehicleId?: string,
  page?: number,
  limit?: number,
) => {
  if (vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        userId,
        deletedAt: null,
      },
      include: { documents: { select: vehicleDocumentSelect } },
    });

    if (!vehicle) {
      throw new Error('VEHICLE_NOT_FOUND');
    }

    return mapVehicle(vehicle);
  }

  // No vehicleId — return all vehicles for the user with pagination
  const actualPage = page || 1;
  const actualLimit = limit || 10;
  const skip = (actualPage - 1) * actualLimit;

  const [vehicles, total] = await Promise.all([
    prisma.vehicle.findMany({
      where: {
        userId,
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: actualLimit,
      include: { documents: { select: vehicleDocumentSelect } },
    }),
    prisma.vehicle.count({
      where: {
        userId,
        deletedAt: null,
      },
    }),
  ]);

  return {
    vehicles: vehicles.map(mapVehicle),
    pagination: {
      page: actualPage,
      limit: actualLimit,
      total,
      totalPages: Math.ceil(total / actualLimit),
    },
  };
};

/* ================= DELETE (SOFT) ================= */
export const deleteVehicle = async (userId: string, vehicleId: string) => {
  const vehicle = await prisma.vehicle.findFirst({
    where: {
      id: vehicleId,
      userId,
      deletedAt: null,
    },
  });

  if (!vehicle) {
    throw new Error('VEHICLE_NOT_FOUND');
  }

  await prisma.vehicle.update({
    where: { id: vehicleId },
    data: { deletedAt: new Date() },
  });

  return true;
};
