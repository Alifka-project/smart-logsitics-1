#!/usr/bin/env node

/**
 * Comprehensive Test Script for All Database-Connected Endpoints
 * Tests all API endpoints that use the database
 */

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const tests = [
  {
    name: 'Database Connection',
    test: async () => {
      await prisma.$queryRaw`SELECT 1`;
      return { success: true, message: 'Database connection successful' };
    }
  },
  {
    name: 'Drivers Table',
    test: async () => {
      const count = await prisma.driver.count();
      const sample = await prisma.driver.findFirst({
        include: { account: true }
      });
      return { 
        success: true, 
        message: `Found ${count} drivers`,
        data: sample ? { id: sample.id, username: sample.username, role: sample.account?.role } : null
      };
    }
  },
  {
    name: 'Accounts Table',
    test: async () => {
      const count = await prisma.account.count();
      return { success: true, message: `Found ${count} accounts` };
    }
  },
  {
    name: 'Deliveries Table',
    test: async () => {
      const count = await prisma.delivery.count();
      const sample = await prisma.delivery.findFirst({
        include: { assignments: true, events: true }
      });
      return { 
        success: true, 
        message: `Found ${count} deliveries`,
        data: sample ? { id: sample.id, customer: sample.customer, status: sample.status } : null
      };
    }
  },
  {
    name: 'Delivery Assignments',
    test: async () => {
      const count = await prisma.deliveryAssignment.count();
      return { success: true, message: `Found ${count} delivery assignments` };
    }
  },
  {
    name: 'Delivery Events',
    test: async () => {
      const count = await prisma.deliveryEvent.count();
      return { success: true, message: `Found ${count} delivery events` };
    }
  },
  {
    name: 'Messages Table',
    test: async () => {
      const count = await prisma.message.count();
      return { success: true, message: `Found ${count} messages` };
    }
  },
  {
    name: 'Live Locations',
    test: async () => {
      const count = await prisma.liveLocation.count();
      return { success: true, message: `Found ${count} live locations` };
    }
  },
  {
    name: 'Driver Status',
    test: async () => {
      const count = await prisma.driverStatus.count();
      return { success: true, message: `Found ${count} driver status records` };
    }
  },
  {
    name: 'SMS Logs',
    test: async () => {
      const count = await prisma.smsLog.count();
      return { success: true, message: `Found ${count} SMS logs` };
    }
  },
  {
    name: 'SMS Confirmations',
    test: async () => {
      const count = await prisma.smsConfirmation.count();
      return { success: true, message: `Found ${count} SMS confirmations` };
    }
  },
  {
    name: 'Complex Query - Dashboard Data',
    test: async () => {
      const deliveries = await prisma.delivery.findMany({
        include: {
          assignments: {
            include: {
              driver: {
                include: {
                  account: true
                }
              }
            }
          },
          events: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
      });
      return { 
        success: true, 
        message: `Fetched ${deliveries.length} deliveries with relations` 
      };
    }
  },
  {
    name: 'Complex Query - Reports Data',
    test: async () => {
      const deliveries = await prisma.delivery.findMany({
        include: {
          assignments: {
            include: {
              driver: {
                include: {
                  account: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
      return { 
        success: true, 
        message: `Fetched ${deliveries.length} deliveries for reports` 
      };
    }
  },
  {
    name: 'Complex Query - Tracking Data',
    test: async () => {
      const [deliveries, assignments, drivers, locations] = await Promise.all([
        prisma.delivery.findMany({ take: 10 }),
        prisma.deliveryAssignment.findMany({ take: 10 }),
        prisma.driver.findMany({ take: 10 }),
        prisma.liveLocation.findMany({ take: 10 })
      ]);
      return { 
        success: true, 
        message: `Tracking data: ${deliveries.length} deliveries, ${assignments.length} assignments, ${drivers.length} drivers, ${locations.length} locations` 
      };
    }
  }
];

async function runAllTests() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   COMPREHENSIVE DATABASE CONNECTION TEST              ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  let passed = 0;
  let failed = 0;
  const results = [];

  for (const test of tests) {
    try {
      console.log(`Testing: ${test.name}...`);
      const result = await test.test();
      if (result.success) {
        console.log(`  ✅ ${result.message}`);
        passed++;
        results.push({ name: test.name, status: 'PASS', message: result.message });
      } else {
        console.log(`  ❌ ${result.message}`);
        failed++;
        results.push({ name: test.name, status: 'FAIL', message: result.message });
      }
    } catch (error) {
      console.log(`  ❌ Error: ${error.message}`);
      failed++;
      results.push({ name: test.name, status: 'ERROR', message: error.message });
    }
  }

  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║   TEST SUMMARY                                           ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  console.log(`Total Tests: ${tests.length}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Success Rate: ${((passed / tests.length) * 100).toFixed(1)}%\n`);

  if (failed === 0) {
    console.log('🎉 All tests passed! Database is fully operational.\n');
  } else {
    console.log('⚠️  Some tests failed. Check the errors above.\n');
  }

  return { passed, failed, results };
}

// Run tests
runAllTests()
  .then(() => {
    prisma.$disconnect();
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    prisma.$disconnect();
    process.exit(1);
  });

