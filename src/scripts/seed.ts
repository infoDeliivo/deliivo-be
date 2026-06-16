import { prisma } from '../config/index.js';
import { UserRole, OnboardingStatus } from '@prisma/client';

async function main() {
  const adminEmail = 'admin@test.dev';
  const adminPhone = '+37251009999';

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: UserRole.ADMIN,
      phone: adminPhone,
      name: 'Admin Baltic',
      nickName: 'admin-baltic',
      emailVerified: true,
      phoneVerified: true,
      isVerified: true,
      onboardingStatus: OnboardingStatus.COMPLETED,
      isBanned: false,
    },
    create: {
      email: adminEmail,
      phone: adminPhone,
      role: UserRole.ADMIN,
      name: 'Admin Baltic',
      nickName: 'admin-baltic',
      emailVerified: true,
      phoneVerified: true,
      isVerified: true,
      onboardingStatus: OnboardingStatus.COMPLETED,
      isBanned: false,
    },
  });

  console.log(`Seeded admin user: ${admin.email} (${admin.id})`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
