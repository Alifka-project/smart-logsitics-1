#!/usr/bin/env node

/**
 * Database Connection Diagnostic Tool
 * This script helps identify why the database connection is failing
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

console.log('\n🔍 DATABASE CONNECTION DIAGNOSTIC');
console.log('==================================\n');

// Step 1: Check environment variables
console.log('1️⃣  Checking Environment Variables...');
const databaseUrl = process.env.DATABASE_URL || process.env.PRISMA_DATABASE_URL;

if (!databaseUrl) {
  console.log('❌ DATABASE_URL is NOT SET');
  console.log('   This is the root cause of the connection failure!');
  console.log('\n   To fix:');
  console.log('   - For local: Create .env file with DATABASE_URL');
  console.log('   - For Vercel: Add DATABASE_URL in Environment Variables');
  console.log('   - Format: postgresql://user:password@host:port/database');
  process.exit(1);
} else {
  console.log('✅ DATABASE_URL is set');
  // Mask sensitive parts
  const masked = databaseUrl.replace(/:([^:@]+)@/, ':****@');
  console.log(`   Connection string: ${masked.substring(0, 60)}...`);
}

// Check other required env vars
console.log('\n2️⃣  Checking Other Environment Variables...');
const requiredVars = {
  'JWT_SECRET': process.env.JWT_SECRET,
  'JWT_REFRESH_SECRET': process.env.JWT_REFRESH_SECRET,
};

for (const [key, value] of Object.entries(requiredVars)) {
  if (value) {
    console.log(`✅ ${key} is set`);
  } else {
    console.log(`⚠️  ${key} is NOT set (may cause auth issues)`);
  }
}

// Step 2: Test Prisma Client initialization
console.log('\n3️⃣  Testing Prisma Client Initialization...');
let prisma;
try {
  prisma = new PrismaClient({
    log: ['error'],
  });
  console.log('✅ Prisma Client created successfully');
} catch (err) {
  console.log('❌ Failed to create Prisma Client');
  console.log(`   Error: ${err.message}`);
  process.exit(1);
}

// Step 3: Test database connection
console.log('\n4️⃣  Testing Database Connection...');
(async () => {
  try {
    const startTime = Date.now();
    const result = await prisma.$queryRaw`SELECT 1 as test, NOW() as server_time`;
    const queryTime = Date.now() - startTime;
    
    console.log('✅ Database connection successful!');
    console.log(`   Query time: ${queryTime}ms`);
    console.log(`   Server time: ${result[0].server_time}`);
    
    // Step 4: Check if tables exist
    console.log('\n5️⃣  Checking Database Schema...');
    try {
      const tables = await prisma.$queryRaw`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        ORDER BY table_name
      `;
      
      console.log(`✅ Found ${tables.length} tables in database:`);
      tables.forEach((t, i) => {
        console.log(`   ${i + 1}. ${t.table_name}`);
      });
      
      // Check for required tables
      const requiredTables = ['drivers', 'accounts', 'deliveries'];
      const tableNames = tables.map(t => t.table_name);
      const missingTables = requiredTables.filter(t => !tableNames.includes(t));
      
      if (missingTables.length > 0) {
        console.log(`\n⚠️  Missing required tables: ${missingTables.join(', ')}`);
        console.log('   Run migrations: npx prisma migrate deploy');
      } else {
        console.log('\n✅ All required tables exist');
      }
      
    } catch (schemaErr) {
      console.log('⚠️  Could not check schema (may not have permissions)');
      console.log(`   Error: ${schemaErr.message}`);
    }
    
    // Step 5: Test a simple query
    console.log('\n6️⃣  Testing Data Query...');
    try {
      const driverCount = await prisma.driver.count();
      const accountCount = await prisma.account.count();
      const deliveryCount = await prisma.delivery.count();
      
      console.log('✅ Data query successful');
      console.log(`   Drivers: ${driverCount}`);
      console.log(`   Accounts: ${accountCount}`);
      console.log(`   Deliveries: ${deliveryCount}`);
      
      if (accountCount === 0) {
        console.log('\n⚠️  No accounts found - you need to create a user to login');
        console.log('   Note: Use real data from your production database');
      }
      
    } catch (queryErr) {
      console.log('❌ Data query failed');
      console.log(`   Error: ${queryErr.message}`);
      console.log(`   Code: ${queryErr.code}`);
      
      if (queryErr.code === 'P2021') {
        console.log('\n   ⚠️  Table does not exist - run migrations!');
        console.log('   Command: npx prisma migrate deploy');
      }
    }
    
    console.log('\n✅ DIAGNOSTIC COMPLETE - Database is working!');
    process.exit(0);
    
  } catch (error) {
    console.log('❌ Database connection FAILED');
    console.log(`   Error: ${error.message}`);
    console.log(`   Code: ${error.code || 'N/A'}`);
    
    // Provide specific guidance based on error
    if (error.code === 'P1000' || error.message.includes("Can't reach database")) {
      console.log('\n🔧 DIAGNOSIS: Cannot reach database server');
      console.log('   Possible causes:');
      console.log('   1. Wrong host/port in DATABASE_URL');
      console.log('   2. Database server is not running');
      console.log('   3. Network/firewall blocking connection');
      console.log('   4. Database credentials are incorrect');
      console.log('\n   To fix:');
      console.log('   - Verify DATABASE_URL is correct');
      console.log('   - Check database server is running');
      console.log('   - Test with: psql "YOUR_DATABASE_URL" -c "SELECT 1"');
    } else if (error.code === 'P1001' || error.message.includes('timeout')) {
      console.log('\n🔧 DIAGNOSIS: Connection timeout');
      console.log('   Possible causes:');
      console.log('   1. Database server is slow or overloaded');
      console.log('   2. Network latency');
      console.log('   3. Firewall blocking connection');
      console.log('\n   To fix:');
      console.log('   - Check database server status');
      console.log('   - Verify network connectivity');
    } else if (error.code === 'P1002' || error.message.includes('authentication')) {
      console.log('\n🔧 DIAGNOSIS: Authentication failed');
      console.log('   Possible causes:');
      console.log('   1. Wrong username or password in DATABASE_URL');
      console.log('   2. User does not have access to database');
      console.log('\n   To fix:');
      console.log('   - Verify credentials in DATABASE_URL');
      console.log('   - Check database user permissions');
    } else if (error.code === 'P1003' || error.message.includes('database')) {
      console.log('\n🔧 DIAGNOSIS: Database does not exist');
      console.log('   Possible causes:');
      console.log('   1. Database name in DATABASE_URL is incorrect');
      console.log('   2. Database was not created');
      console.log('\n   To fix:');
      console.log('   - Create the database');
      console.log('   - Update DATABASE_URL with correct database name');
    } else {
      console.log('\n🔧 DIAGNOSIS: Unknown database error');
      console.log('   Check the error message above for details');
    }
    
    process.exit(1);
  } finally {
    if (prisma) {
      await prisma.$disconnect();
    }
  }
})();

