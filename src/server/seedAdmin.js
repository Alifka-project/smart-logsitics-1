const { prisma } = require('./db');
const { hashPassword } = require('./auth');

async function seed() {
  try {
    const username = process.env.ADMIN_USER || 'admin';
    const password = process.env.ADMIN_PASS || 'adminpass';
    const email = process.env.ADMIN_EMAIL || 'admin@example.com';

    const existing = await prisma.driver.findFirst({ where: { username } });
    if (existing) {
      console.log('Admin user already exists');
      return;
    }

    const driver = await prisma.driver.create({
      data: {
        username,
        email,
        fullName: 'Administrator',
        active: true,
      },
    });

    const pwHash = await hashPassword(password);
    await prisma.account.create({
      data: {
        driverId: driver.id,
        passwordHash: pwHash,
        role: 'admin',
      },
    });

    console.log('Seeded admin:', username);
  } catch (err) {
    console.error('seed error', err);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

seed();
