#!/usr/bin/env node
/**
 * Test POD Report Date Filtering
 * This will show what the issue is with date filters
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testPODReportDates() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           POD REPORT DATE FILTER TEST                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Test with the dates from the UI: 02/09/2026 to 02/16/2026
    const startDateStr = '02/09/2026';
    const endDateStr = '02/16/2026';
    
    console.log('📅 Test Date Range:');
    console.log(`   Start: ${startDateStr}`);
    console.log(`   End: ${endDateStr}\n`);

    // Parse dates as they would be in the API
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);
    
    console.log('📅 Parsed Dates:');
    console.log(`   Start: ${startDate.toISOString()}`);
    console.log(`   End: ${endDate.toISOString()}\n`);

    // Get all delivered deliveries with POD
    console.log('🔍 Querying database...\n');
    
    const allDelivered = await prisma.delivery.findMany({
      where: {
        status: {
          in: ['delivered', 'completed', 'done', 'delivered-with-installation', 'delivered-without-installation']
        }
      },
      select: {
        id: true,
        customer: true,
        status: true,
        deliveredAt: true,
        createdAt: true,
        driverSignature: true,
        customerSignature: true,
        photos: true
      },
      orderBy: { deliveredAt: 'desc' }
    });

    console.log(`📦 Total delivered orders: ${allDelivered.length}\n`);
    
    if (allDelivered.length > 0) {
      console.log('📋 ALL Delivered Orders (regardless of date):');
      allDelivered.forEach((d, i) => {
        const hasPOD = !!(d.driverSignature || d.customerSignature || (d.photos && Array.isArray(d.photos) && d.photos.length > 0));
        console.log(`\n   ${i + 1}. ${d.customer} (${d.status})`);
        console.log(`      Delivered At: ${d.deliveredAt || 'Not set'}`);
        console.log(`      Created At: ${d.createdAt}`);
        console.log(`      Has POD: ${hasPOD ? 'YES ✓' : 'NO ✗'}`);
        
        // Check if it falls in date range
        const deliveryDate = d.deliveredAt || d.createdAt;
        const inRange = deliveryDate >= startDate && deliveryDate <= endDate;
        console.log(`      In Range (${startDateStr} - ${endDateStr}): ${inRange ? 'YES ✓' : 'NO ✗'}`);
        
        if (!inRange) {
          if (deliveryDate < startDate) {
            console.log(`         → BEFORE start date`);
          } else if (deliveryDate > endDate) {
            console.log(`         → AFTER end date`);
          }
        }
      });
      console.log('');
    }

    // Now test with the ACTUAL query from the API
    console.log('🔍 Testing API Query with Date Filter...\n');
    
    const filteredDeliveries = await prisma.delivery.findMany({
      where: {
        status: {
          in: ['delivered', 'completed', 'done', 'delivered-with-installation', 'delivered-without-installation']
        },
        OR: [
          {
            deliveredAt: {
              gte: startDate,
              lte: endDate
            }
          },
          {
            deliveredAt: null,
            createdAt: {
              gte: startDate,
              lte: endDate
            }
          }
        ]
      },
      select: {
        id: true,
        customer: true,
        status: true,
        deliveredAt: true,
        createdAt: true,
        driverSignature: true,
        customerSignature: true,
        photos: true
      },
      orderBy: { deliveredAt: 'desc' }
    });

    console.log(`📦 Filtered results: ${filteredDeliveries.length}\n`);
    
    if (filteredDeliveries.length > 0) {
      console.log('✅ Deliveries WITHIN date range:');
      filteredDeliveries.forEach((d, i) => {
        const hasPOD = !!(d.driverSignature || d.customerSignature || (d.photos && Array.isArray(d.photos) && d.photos.length > 0));
        console.log(`\n   ${i + 1}. ${d.customer} (${d.status})`);
        console.log(`      Delivered At: ${d.deliveredAt || 'Not set'}`);
        console.log(`      Created At: ${d.createdAt}`);
        console.log(`      Has POD: ${hasPOD ? 'YES ✓' : 'NO ✗'}`);
      });
    } else {
      console.log('❌ NO deliveries found within date range!');
      console.log('   This explains why the report shows 0.');
    }

    // Summary
    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║                         DIAGNOSIS                              ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    
    console.log('📊 Results:');
    console.log(`   Total delivered orders: ${allDelivered.length}`);
    console.log(`   Orders in date range: ${filteredDeliveries.length}`);
    console.log(`   Orders with POD (all): ${allDelivered.filter(d => d.driverSignature || d.customerSignature || (d.photos && d.photos.length > 0)).length}`);
    console.log(`   Orders with POD (in range): ${filteredDeliveries.filter(d => d.driverSignature || d.customerSignature || (d.photos && d.photos.length > 0)).length}\n`);

    if (allDelivered.length > 0 && filteredDeliveries.length === 0) {
      console.log('🔧 ISSUE IDENTIFIED:');
      console.log('   The date filter is excluding all deliveries!');
      console.log('');
      console.log('💡 Possible causes:');
      console.log('   1. Date parsing issue (MM/DD/YYYY vs DD/MM/YYYY)');
      console.log('   2. Timezone mismatch');
      console.log('   3. End date not including full day');
      console.log('');
      console.log('💡 Solution:');
      console.log('   Set endDate to END of day instead of start of day:');
      console.log('   endDate.setHours(23, 59, 59, 999)');
      console.log('');
    } else if (filteredDeliveries.length > 0) {
      console.log('✅ Date filter is working correctly!');
      console.log('   If report still shows 0, check frontend display logic.');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

testPODReportDates().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
