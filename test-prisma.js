const prisma = require('./src/server/db/prisma');

(async () => {
  try {
    await prisma.$connect();
    console.log('✅ Prisma connection: SUCCESS');
    
    const driverCount = await prisma.driver.count();
    console.log('✅ Driver count:', driverCount);
    
    const deliveryCount = await prisma.delivery.count();
    console.log('✅ Delivery count:', deliveryCount);
    
    const accountCount = await prisma.account.count();
    console.log('✅ Account count:', accountCount);
    
    const drivers = await prisma.driver.findMany({
      take: 2,
      include: {
        account: {
          select: {
            role: true
          }
        }
      }
    });
    console.log('✅ Sample drivers query: SUCCESS');
    console.log('   Found', drivers.length, 'drivers');
    
    console.log('\n✅ All Prisma queries working perfectly!');
    console.log('✅ Database: PostgreSQL via Prisma ORM');
    
    await prisma.$disconnect();
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err);
    process.exit(1);
  }
})();
