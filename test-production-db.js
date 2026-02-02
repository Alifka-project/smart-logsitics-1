#!/usr/bin/env node

/**
 * Production Database Connection Test
 * Tests connection to Prisma Cloud database
 */

const { PrismaClient } = require('@prisma/client');

// Use production DATABASE_URL
const DATABASE_URL = process.env.DATABASE_URL || "postgres://6a81efaf74f4a117a2bd64fd43af9aae5ad5209628abe313dc93933e468e2a64:sk_ayxWM3HTphNUmIhEUYv__@db.prisma.io:5432/postgres?sslmode=require";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: DATABASE_URL
    }
  }
});

async function testProductionDatabase() {
  console.log('\n🔍 Testing PRODUCTION Database Connection...\n');
  console.log('Database: Prisma Cloud PostgreSQL');
  console.log('Host: db.prisma.io\n');
  
  try {
    // Test connection
    await prisma.$connect();
    console.log('✅ Connected to production database!\n');

    // Get database version
    const result = await prisma.$queryRaw`SELECT version()`;
    console.log(`📊 PostgreSQL version: ${result[0].version.split(' ')[1]}\n`);

    // Check tables
    console.log('📋 Checking tables...');
    
    const drivers = await prisma.driver.count();
    const accounts = await prisma.account.count();
    const deliveries = await prisma.delivery.count();
    
    console.log(`   Drivers: ${drivers}`);
    console.log(`   Accounts: ${accounts}`);
    console.log(`   Deliveries: ${deliveries}`);
    
    // Check admin
    const admin = await prisma.driver.findFirst({
      where: { 
        account: {
          role: 'admin'
        }
      },
      include: { account: true }
    });
    
    if (admin) {
      console.log('\n👤 Admin account found:');
      console.log(`   Username: ${admin.username}`);
      console.log(`   Role: ${admin.account.role}`);
    }
    
    console.log('\n✨ Production database is operational!\n');
    return true;
    
  } catch (error) {
    console.error('❌ Production database connection failed!');
    console.error('Error:', error.message);
    console.error('\n📝 Details:', error);
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

testProductionDatabase()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
