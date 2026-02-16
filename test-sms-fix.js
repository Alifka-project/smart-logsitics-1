#!/usr/bin/env node
/**
 * Test Script: Verify SMS Fix and Database State
 * This script checks if:
 * 1. Database has deliveries
 * 2. Deliveries have valid UUID IDs
 * 3. Can simulate SMS send with real ID
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testSMSFix() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║          SMS FIX VERIFICATION TEST                             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Test 1: Check database connection
    console.log('🔍 Test 1: Database Connection');
    console.log('─'.repeat(60));
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log('✅ Database connection: SUCCESS\n');
    } catch (error) {
      console.error('❌ Database connection: FAILED');
      console.error('   Error:', error.message);
      console.error('   Make sure DATABASE_URL is set correctly\n');
      return;
    }

    // Test 2: Check if deliveries exist
    console.log('🔍 Test 2: Check Deliveries in Database');
    console.log('─'.repeat(60));
    const deliveryCount = await prisma.delivery.count();
    console.log(`📦 Total deliveries in database: ${deliveryCount}`);
    
    if (deliveryCount === 0) {
      console.log('⚠️  WARNING: No deliveries found in database!');
      console.log('   You need to upload deliveries first.');
      console.log('   Steps:');
      console.log('   1. Go to your web app');
      console.log('   2. Upload delivery format small.xlsx');
      console.log('   3. Then test SMS\n');
      return;
    }
    console.log('✅ Deliveries found!\n');

    // Test 3: Get sample delivery and verify ID format
    console.log('🔍 Test 3: Verify Delivery ID Format');
    console.log('─'.repeat(60));
    const sampleDeliveries = await prisma.delivery.findMany({
      take: 5,
      select: {
        id: true,
        customer: true,
        phone: true,
        address: true,
        status: true,
        createdAt: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    console.log(`Found ${sampleDeliveries.length} recent deliveries:\n`);
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    let validCount = 0;
    let invalidCount = 0;
    let deliveryWithPhone = null;
    
    sampleDeliveries.forEach((delivery, index) => {
      const isValidUUID = uuidRegex.test(delivery.id);
      const icon = isValidUUID ? '✅' : '❌';
      
      console.log(`${icon} Delivery ${index + 1}:`);
      console.log(`   ID: ${delivery.id} ${isValidUUID ? '(Valid UUID)' : '(INVALID - Not UUID!)'}`);
      console.log(`   Customer: ${delivery.customer}`);
      console.log(`   Phone: ${delivery.phone || 'NO PHONE'}`);
      console.log(`   Status: ${delivery.status}`);
      console.log(`   Created: ${delivery.createdAt}`);
      console.log('');
      
      if (isValidUUID) {
        validCount++;
        if (delivery.phone && !deliveryWithPhone) {
          deliveryWithPhone = delivery;
        }
      } else {
        invalidCount++;
      }
    });

    console.log(`Summary: ${validCount} valid UUIDs, ${invalidCount} invalid IDs\n`);

    if (invalidCount > 0) {
      console.log('⚠️  WARNING: Some deliveries have invalid IDs!');
      console.log('   This should not happen. Database should only have UUIDs.\n');
    }

    // Test 4: Simulate SMS send (check if we can find delivery by ID)
    if (deliveryWithPhone) {
      console.log('🔍 Test 4: Simulate SMS Send');
      console.log('─'.repeat(60));
      console.log(`Testing with delivery ID: ${deliveryWithPhone.id}`);
      
      // Try to find delivery (this is what SMS endpoint does)
      const foundDelivery = await prisma.delivery.findUnique({
        where: { id: deliveryWithPhone.id }
      });
      
      if (foundDelivery) {
        console.log('✅ SUCCESS: Delivery found by UUID!');
        console.log(`   Customer: ${foundDelivery.customer}`);
        console.log(`   Phone: ${foundDelivery.phone}`);
        console.log('   → SMS would work with this ID!\n');
      } else {
        console.log('❌ FAILED: Could not find delivery by ID');
        console.log('   This should not happen!\n');
      }
    } else {
      console.log('⚠️  Test 4: SKIPPED (no delivery with phone number found)\n');
    }

    // Test 5: Check for your specific phone number
    console.log('🔍 Test 5: Check for Your Phone Number (+971588712409)');
    console.log('─'.repeat(60));
    const yourDeliveries = await prisma.delivery.findMany({
      where: {
        phone: {
          contains: '971588712409'
        }
      },
      select: {
        id: true,
        customer: true,
        phone: true,
        status: true
      }
    });

    if (yourDeliveries.length > 0) {
      console.log(`✅ Found ${yourDeliveries.length} delivery(ies) with your phone number!`);
      yourDeliveries.forEach((d, i) => {
        console.log(`\n   Delivery ${i + 1}:`);
        console.log(`   ID: ${d.id}`);
        console.log(`   Customer: ${d.customer}`);
        console.log(`   Phone: ${d.phone}`);
        console.log(`   Status: ${d.status}`);
      });
      console.log('\n✅ You can test SMS with these deliveries!\n');
    } else {
      console.log('⚠️  No deliveries found with your phone number (+971588712409)');
      console.log('   Make sure your Excel file has your phone number\n');
    }

    // Final summary
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                      TEST SUMMARY                              ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    
    if (deliveryCount > 0 && validCount === sampleDeliveries.length) {
      console.log('✅ ALL TESTS PASSED!');
      console.log('   - Database connected');
      console.log('   - Deliveries exist');
      console.log('   - All IDs are valid UUIDs');
      console.log('   - SMS should work!\n');
      
      console.log('🎯 NEXT STEPS:');
      console.log('   1. Clear your browser cache (localStorage)');
      console.log('   2. Refresh the page');
      console.log('   3. Re-upload your Excel file (or just refresh if already uploaded)');
      console.log('   4. Click SMS button');
      console.log('   5. It should work now!\n');
    } else if (deliveryCount === 0) {
      console.log('⚠️  NO DELIVERIES IN DATABASE');
      console.log('   Upload your Excel file first!\n');
    } else {
      console.log('⚠️  SOME ISSUES DETECTED');
      console.log('   Check warnings above\n');
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
testSMSFix().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
