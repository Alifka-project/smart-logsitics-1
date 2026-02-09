const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

async function initializeAccounts() {
  const prisma = new PrismaClient();
  
  try {
    console.log('🚀 Initializing user accounts...\n');
    
    const accounts = [
      { 
        username: 'Admin', 
        password: 'Admin123!', 
        email: 'admin@dubailogistics.com',
        fullName: 'System Administrator',
        role: 'admin'
      },
      { 
        username: 'Driver1', 
        password: 'Driver123',
        email: 'driver1@dubailogistics.com',
        fullName: 'Driver One',
        role: 'driver'
      },
      { 
        username: 'alifka', 
        password: 'Alifka123',
        email: 'alifka@dubailogistics.com',
        fullName: 'Alifka User',
        role: 'driver'
      }
    ];
    
    for (const acc of accounts) {
      let driver = await prisma.driver.findUnique({
        where: { username: acc.username },
        include: { account: true }
      });
      
      if (!driver) {
        console.log(`Creating ${acc.username}...`);
        const passwordHash = await bcrypt.hash(acc.password, 10);
        driver = await prisma.driver.create({
          data: {
            username: acc.username,
            email: acc.email,
            fullName: acc.fullName,
            active: true,
            account: {
              create: {
                passwordHash: passwordHash,
                role: acc.role
              }
            }
          }
        });
        console.log(`✅ Created ${acc.username}`);
      } else {
        console.log(`Updating ${acc.username}...`);
        const passwordHash = await bcrypt.hash(acc.password, 10);
        await prisma.account.update({
          where: { id: driver.account.id },
          data: { passwordHash: passwordHash }
        });
        if (!driver.email) {
          await prisma.driver.update({
            where: { id: driver.id },
            data: { email: acc.email, fullName: acc.fullName }
          });
        }
        console.log(`✅ Updated ${acc.username}`);
      }
    }
    
    console.log('\n✅ All accounts initialized successfully!\n');
    console.log('Login Credentials:');
    console.log('─────────────────────────────────────');
    console.log('Admin:   Username: Admin   | Password: Admin123!');
    console.log('Driver:  Username: Driver1 | Password: Driver123');
    console.log('Alifka:  Username: alifka  | Password: Alifka123');
    console.log('─────────────────────────────────────\n');
    
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error initializing accounts:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

initializeAccounts();
