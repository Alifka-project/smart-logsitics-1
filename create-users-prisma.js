/**
 * Create default admin and driver users using Prisma
 * Run with: node create-users-prisma.js
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function createDefaultUsers() {
  try {
    console.log('Creating default users...\n');

    // Admin account
    const adminUsername = 'admin';
    const adminPassword = 'admin123';
    const adminEmail = 'admin@dubailogistics.com';
    const adminFullName = 'System Administrator';

    // Driver account
    const driverUsername = 'driver1';
    const driverPassword = 'driver123';
    const driverEmail = 'driver1@dubailogistics.com';
    const driverFullName = 'Test Driver';

    // Check if admin already exists
    const existingAdmin = await prisma.driver.findFirst({
      where: { username: adminUsername }
    });

    if (existingAdmin) {
      console.log(`✓ Admin user '${adminUsername}' already exists`);
    } else {
      // Create admin driver
      const adminDriver = await prisma.driver.create({
        data: {
          username: adminUsername,
          email: adminEmail,
          fullName: adminFullName,
          active: true,
          account: {
            create: {
              passwordHash: await bcrypt.hash(adminPassword, 10),
              role: 'admin'
            }
          }
        },
        include: { account: true }
      });

      console.log(`✓ Created admin user:`);
      console.log(`  Username: ${adminUsername}`);
      console.log(`  Password: ${adminPassword}`);
      console.log(`  Email: ${adminEmail}`);
    }

    // Check if driver already exists
    const existingDriver = await prisma.driver.findFirst({
      where: { username: driverUsername }
    });

    if (existingDriver) {
      console.log(`✓ Driver user '${driverUsername}' already exists`);
    } else {
      // Create driver
      const driver = await prisma.driver.create({
        data: {
          username: driverUsername,
          email: driverEmail,
          fullName: driverFullName,
          active: true,
          account: {
            create: {
              passwordHash: await bcrypt.hash(driverPassword, 10),
              role: 'driver'
            }
          }
        },
        include: { account: true }
      });

      console.log(`✓ Created driver user:`);
      console.log(`  Username: ${driverUsername}`);
      console.log(`  Password: ${driverPassword}`);
      console.log(`  Email: ${driverEmail}`);
    }

    console.log('\n✅ Default users created successfully!');
    console.log('\nYou can now login with:');
    console.log(`- Admin: ${adminUsername} / ${adminPassword}`);
    console.log(`- Driver: ${driverUsername} / ${driverPassword}`);

  } catch (error) {
    console.error('❌ Error creating users:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createDefaultUsers();
