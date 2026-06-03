import { prisma } from '../../config/index.js';
import { VehicleType } from '@prisma/client';

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
  const data = await prisma.vehicle.update({
    where: { id: vehicleId },
    data: update,
  })

  return { success: true, message: 'Vehicle updated successfully', data };
};

/* ================= GET VEHICLE ================= */
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
    });

    if (!vehicle) {
      throw new Error('VEHICLE_NOT_FOUND');
    }

    return vehicle;
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
    }),
    prisma.vehicle.count({
      where: {
        userId,
        deletedAt: null,
      },
    }),
  ]);

  return {
    vehicles,
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
