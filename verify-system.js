#!/usr/bin/env node

/**
 * Comprehensive System Verification Script
 * Checks database connection, API endpoints, and system health
 */

const { PrismaClient } = require('@prisma/client');
const http = require('http');

const prisma = new PrismaClient();

const COLORS = {
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[36m',
  RESET: '\x1b[0m',
};

function log(color, symbol, message) {
  console.log(`${color}${symbol} ${message}${COLORS.RESET}`);
}

function success(message) {
  log(COLORS.GREEN, '✅', message);
}

function error(message) {
  log(COLORS.RED, '❌', message);
}

function info(message) {
  log(COLORS.BLUE, 'ℹ️ ', message);
}

function warning(message) {
  log(COLORS.YELLOW, '⚠️ ', message);
}

async function testDatabaseConnection() {
  console.log('\n' + '='.repeat(60));
  console.log('1️⃣  DATABASE CONNECTION TEST');
  console.log('='.repeat(60));
  
  try {
    await prisma.$connect();
    success('Database connected successfully');
    
    // Test query
    const result = await prisma.$queryRaw`SELECT version()`;
    info(`PostgreSQL version: ${result[0].version.split(' ')[1]}`);
    
    return true;
  } catch (err) {
    error(`Database connection failed: ${err.message}`);
    return false;
  }
}

async function checkDatabaseTables() {
  console.log('\n' + '='.repeat(60));
  console.log('2️⃣  DATABASE TABLES VERIFICATION');
  console.log('='.repeat(60));
  
  const tables = [
    { name: 'Drivers', model: 'driver' },
    { name: 'Accounts', model: 'account' },
    { name: 'Deliveries', model: 'delivery' },
    { name: 'Delivery Assignments', model: 'deliveryAssignment' },
    { name: 'Driver Status', model: 'driverStatus' },
    { name: 'Live Locations', model: 'liveLocation' },
    { name: 'Delivery Events', model: 'deliveryEvent' },
    { name: 'Messages', model: 'message' },
    { name: 'SMS Logs', model: 'smsLog' },
    { name: 'SMS Confirmations', model: 'smsConfirmation' },
    { name: 'Password Resets', model: 'passwordReset' },
  ];
  
  let allGood = true;
  
  for (const table of tables) {
    try {
      const count = await prisma[table.model].count();
      info(`${table.name.padEnd(25)} ${count} records`);
    } catch (err) {
      error(`${table.name} - ERROR: ${err.message}`);
      allGood = false;
    }
  }
  
  return allGood;
}

async function checkAdminAccount() {
  console.log('\n' + '='.repeat(60));
  console.log('3️⃣  ADMIN ACCOUNT VERIFICATION');
  console.log('='.repeat(60));
  
  try {
    const admin = await prisma.driver.findUnique({
      where: { username: 'admin' },
      include: { account: true }
    });
    
    if (!admin) {
      error('Admin account not found');
      return false;
    }
    
    success('Admin account exists');
    info(`Username: ${admin.username}`);
    info(`Email: ${admin.email}`);
    info(`Role: ${admin.account.role}`);
    info(`Has password: ${admin.account.passwordHash ? 'Yes' : 'No'}`);
    info(`Active: ${admin.active ? 'Yes' : 'No'}`);
    
    return true;
  } catch (err) {
    error(`Admin check failed: ${err.message}`);
    return false;
  }
}

function testAPIEndpoint(path, method = 'GET', data = null) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 4000,
      path: `/api${path}`,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 5000
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({
          success: true,
          statusCode: res.statusCode,
          body: body
        });
      });
    });
    
    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Request timeout' });
    });
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function testAPIEndpoints() {
  console.log('\n' + '='.repeat(60));
  console.log('4️⃣  API ENDPOINTS VERIFICATION');
  console.log('='.repeat(60));
  
  // Test if server is running
  const healthCheck = await testAPIEndpoint('/drivers');
  
  if (!healthCheck.success) {
    error('Backend server is not running or not accessible');
    warning('Please ensure the backend server is started on port 4000');
    return false;
  }
  
  success('Backend server is accessible');
  info(`Server responded with status: ${healthCheck.statusCode}`);
  
  // Test login endpoint
  const loginTest = await testAPIEndpoint('/auth/login', 'POST', {
    username: 'admin',
    password: 'admin123'
  });
  
  if (loginTest.success && loginTest.statusCode === 200) {
    try {
      const loginData = JSON.parse(loginTest.body);
      if (loginData.token) {
        success('Login endpoint working correctly');
        info('JWT token generated successfully');
      } else {
        warning('Login endpoint responded but no token received');
      }
    } catch (e) {
      error('Login response parsing failed');
    }
  } else {
    error('Login endpoint failed');
    if (loginTest.error) {
      info(`Error: ${loginTest.error}`);
    }
  }
  
  return true;
}

async function checkEnvironmentVariables() {
  console.log('\n' + '='.repeat(60));
  console.log('5️⃣  ENVIRONMENT VARIABLES');
  console.log('='.repeat(60));
  
  const requiredVars = [
    'DATABASE_URL',
    'JWT_SECRET',
    'PORT',
    'NODE_ENV',
  ];
  
  let allSet = true;
  
  for (const varName of requiredVars) {
    if (process.env[varName]) {
      const value = varName.includes('SECRET') || varName.includes('PASSWORD') || varName.includes('URL')
        ? '****' + process.env[varName].slice(-10)
        : process.env[varName];
      success(`${varName.padEnd(20)} ${value}`);
    } else {
      error(`${varName} is not set`);
      allSet = false;
    }
  }
  
  // Optional but recommended
  const optionalVars = ['JWT_REFRESH_SECRET', 'CORS_ORIGINS', 'FRONTEND_URL'];
  
  console.log('\nOptional variables:');
  for (const varName of optionalVars) {
    if (process.env[varName]) {
      const value = varName.includes('SECRET') 
        ? '****' 
        : process.env[varName];
      info(`${varName.padEnd(20)} ${value}`);
    } else {
      warning(`${varName.padEnd(20)} Not set (optional)`);
    }
  }
  
  return allSet;
}

async function generateSummaryReport() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 SYSTEM STATUS SUMMARY');
  console.log('='.repeat(60));
  
  const drivers = await prisma.driver.count();
  const accounts = await prisma.account.count();
  const deliveries = await prisma.delivery.count();
  const assignments = await prisma.deliveryAssignment.count();
  
  console.log('\nDatabase Statistics:');
  info(`Total Drivers: ${drivers}`);
  info(`Total Accounts: ${accounts}`);
  info(`Total Deliveries: ${deliveries}`);
  info(`Active Assignments: ${assignments}`);
  
  console.log('\nSystem URLs:');
  info(`Frontend: http://localhost:5173`);
  info(`Backend API: http://localhost:4000`);
  info(`Database: localhost:5432 (PostgreSQL)`);
  
  console.log('\nCredentials:');
  info(`Admin Username: admin`);
  info(`Admin Password: admin123`);
}

async function main() {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   🚀 SMART LOGISTICS SYSTEM VERIFICATION                 ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  
  let allTestsPassed = true;
  
  // Run all tests
  allTestsPassed = await testDatabaseConnection() && allTestsPassed;
  allTestsPassed = await checkDatabaseTables() && allTestsPassed;
  allTestsPassed = await checkAdminAccount() && allTestsPassed;
  allTestsPassed = await checkEnvironmentVariables() && allTestsPassed;
  await testAPIEndpoints(); // Don't fail on API tests if server isn't running
  
  await generateSummaryReport();
  
  console.log('\n' + '='.repeat(60));
  if (allTestsPassed) {
    success('ALL CRITICAL TESTS PASSED ✨');
    console.log('\n💡 Your system is ready to use!');
    console.log('   1. Ensure backend server is running: npm run dev:backend');
    console.log('   2. Ensure frontend is running: npm run dev:frontend');
    console.log('   3. Access the system at: http://localhost:5173');
  } else {
    error('SOME TESTS FAILED');
    console.log('\n💡 Please review the errors above and fix them.');
  }
  console.log('='.repeat(60));
  console.log('\n');
  
  await prisma.$disconnect();
  process.exit(allTestsPassed ? 0 : 1);
}

main().catch((error) => {
  error(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
