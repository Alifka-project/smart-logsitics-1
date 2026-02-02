const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testDatabaseConnection() {
  try {
    console.log('🔍 Testing database connection...\n');

    // Test connection
    await prisma.$connect();
    console.log('✅ Database connection successful!\n');

    // Check all tables and count records
    console.log('📊 Checking database tables:\n');

    const drivers = await prisma.driver.count();
    console.log(`   Drivers: ${drivers} records`);

    const accounts = await prisma.account.count();
    console.log(`   Accounts: ${accounts} records`);

    const deliveries = await prisma.delivery.count();
    console.log(`   Deliveries: ${deliveries} records`);

    const assignments = await prisma.deliveryAssignment.count();
    console.log(`   Delivery Assignments: ${assignments} records`);

    const driverStatus = await prisma.driverStatus.count();
    console.log(`   Driver Status: ${driverStatus} records`);

    const locations = await prisma.liveLocation.count();
    console.log(`   Live Locations: ${locations} records`);

    const deliveryEvents = await prisma.deliveryEvent.count();
    console.log(`   Delivery Events: ${deliveryEvents} records`);

    const messages = await prisma.message.count();
    console.log(`   Messages: ${messages} records`);

    const smsLogs = await prisma.smsLog.count();
    console.log(`   SMS Logs: ${smsLogs} records`);

    const smsConfirmations = await prisma.smsConfirmation.count();
    console.log(`   SMS Confirmations: ${smsConfirmations} records`);

    const passwordResets = await prisma.passwordReset.count();
    console.log(`   Password Resets: ${passwordResets} records`);

    console.log('\n✨ All tables are accessible!\n');

    // Check if admin account exists
    const adminAccount = await prisma.account.findFirst({
      where: { role: 'admin' },
      include: { driver: true }
    });

    if (adminAccount) {
      console.log('👤 Admin account found:');
      console.log(`   Username: ${adminAccount.driver.username}`);
      console.log(`   Email: ${adminAccount.driver.email}`);
      console.log(`   Role: ${adminAccount.role}`);
    } else {
      console.log('⚠️  No admin account found in the database');
    }

    console.log('\n🎉 Database verification complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testDatabaseConnection();
