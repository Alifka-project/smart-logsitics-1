/**
 * Seed default users using Prisma
 * Database is REQUIRED - Uses Prisma ORM
 */

const prisma = require('./db/prisma');
const { hashPassword } = require('./auth');

async function ensureUser(username, password, role, email, fullName) {
  try {
    // Check if user exists
    const existing = await prisma.driver.findUnique({
      where: { username },
      include: { account: true }
    });

    if (existing) {
      console.log(`User ${username} already exists`);
      return;
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create driver and account in transaction
    await prisma.$transaction(async (tx) => {
      const driver = await tx.driver.create({
        data: {
          username,
          email: email || null,
          fullName: fullName || username,
          account: {
            create: {
              passwordHash,
              role,
            }
          }
        }
      });
      console.log(`Seeded user ${username} with role ${role}`);
      return driver;
    });
  } catch (err) {
    console.error('ensureUser error', err);
    throw err;
  }
}

async function run() {
  try {
    const adminUser = process.env.ADMIN_USER || 'Admin';
    const adminPass = process.env.ADMIN_PASS || 'Admin123';
    const driverUser = process.env.DRIVER_USER || 'Driver1';
    const driverPass = process.env.DRIVER_PASS || 'Driver123';

    await ensureUser(adminUser, adminPass, 'admin', 'admin@dubailogistics.com', 'Administrator');
    await ensureUser(driverUser, driverPass, 'driver', null, 'Driver One');
  } catch (e) {
    console.error('seed run failed', e);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

run();
