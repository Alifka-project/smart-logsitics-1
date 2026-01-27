const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAdmin() {
  try {
    console.log('Checking for admin accounts...');
    
    const allAccounts = await prisma.account.findMany({
      include: { driver: { select: { id: true, fullName: true, username: true } } }
    });
    
    console.log('All accounts in database:');
    allAccounts.forEach(acc => {
      console.log(`  - ID: ${acc.id}, Role: ${acc.role}, Driver: ${acc.driver?.fullName || 'N/A'}`);
    });
    
    const adminAccounts = await prisma.account.findMany({
      where: { role: 'admin' },
      include: { driver: true }
    });
    
    console.log(`\nFound ${adminAccounts.length} admin accounts`);
    
    if (adminAccounts.length === 0) {
      console.log('WARNING: No admin accounts found in database!');
    } else {
      adminAccounts.forEach(acc => {
        console.log(`  - Admin: ${acc.driver?.fullName}`);
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkAdmin();
