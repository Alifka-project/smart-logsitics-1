#!/usr/bin/env node
/**
 * Check POD Data in Database
 * This script will verify if POD images and data are being saved
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkPODData() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              POD DATA VERIFICATION                             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Check database connection
    console.log('🔍 Checking database connection...');
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database connected\n');

    // Count all deliveries
    console.log('📦 Checking deliveries...');
    const totalDeliveries = await prisma.delivery.count();
    console.log(`   Total deliveries: ${totalDeliveries}`);

    // Count delivered deliveries
    const deliveredCount = await prisma.delivery.count({
      where: {
        status: {
          in: ['delivered', 'delivered-with-installation', 'completed']
        }
      }
    });
    console.log(`   Delivered: ${deliveredCount}`);

    // Count deliveries WITH POD data
    const withPODCount = await prisma.delivery.count({
      where: {
        OR: [
          { driverSignature: { not: null } },
          { customerSignature: { not: null } },
          { photos: { not: null } }
        ]
      }
    });
    console.log(`   With POD data: ${withPODCount}\n`);

    // Get sample deliveries with POD
    console.log('🔍 Checking POD details...\n');
    const deliveriesWithPOD = await prisma.delivery.findMany({
      where: {
        OR: [
          { driverSignature: { not: null } },
          { customerSignature: { not: null } },
          { photos: { not: null } }
        ]
      },
      select: {
        id: true,
        customer: true,
        status: true,
        driverSignature: true,
        customerSignature: true,
        photos: true,
        deliveredAt: true,
        podCompletedAt: true,
        deliveryNotes: true,
        conditionNotes: true
      },
      take: 5
    });

    if (deliveriesWithPOD.length === 0) {
      console.log('❌ NO POD DATA FOUND!');
      console.log('   No deliveries have:');
      console.log('   - Driver signatures');
      console.log('   - Customer signatures');
      console.log('   - Photos\n');
      
      // Check if there are any delivered deliveries without POD
      const deliveredNoPOD = await prisma.delivery.findMany({
        where: {
          status: {
            in: ['delivered', 'delivered-with-installation', 'completed']
          }
        },
        select: {
          id: true,
          customer: true,
          status: true,
          deliveredAt: true,
          driverSignature: true,
          customerSignature: true,
          photos: true
        },
        take: 5
      });

      if (deliveredNoPOD.length > 0) {
        console.log(`⚠️  Found ${deliveredNoPOD.length} delivered orders WITHOUT POD:`);
        deliveredNoPOD.forEach((d, i) => {
          console.log(`\n   ${i + 1}. Delivery: ${d.id.substring(0, 8)}...`);
          console.log(`      Customer: ${d.customer}`);
          console.log(`      Status: ${d.status}`);
          console.log(`      Delivered: ${d.deliveredAt || 'Not recorded'}`);
          console.log(`      Driver Signature: ${d.driverSignature ? 'YES ✓' : 'NO ✗'}`);
          console.log(`      Customer Signature: ${d.customerSignature ? 'YES ✓' : 'NO ✗'}`);
          console.log(`      Photos: ${d.photos ? 'YES ✓' : 'NO ✗'}`);
        });
      }
      
    } else {
      console.log(`✅ Found ${deliveriesWithPOD.length} deliveries with POD data:\n`);
      
      deliveriesWithPOD.forEach((d, i) => {
        console.log(`📋 Delivery ${i + 1}:`);
        console.log(`   ID: ${d.id}`);
        console.log(`   Customer: ${d.customer}`);
        console.log(`   Status: ${d.status}`);
        console.log(`   Delivered: ${d.deliveredAt || 'Not set'}`);
        console.log(`   POD Completed: ${d.podCompletedAt || 'Not set'}`);
        
        // Check what POD data exists
        const hasDriverSig = !!d.driverSignature;
        const hasCustomerSig = !!d.customerSignature;
        const hasPhotos = d.photos && Array.isArray(d.photos) && d.photos.length > 0;
        
        console.log(`   Driver Signature: ${hasDriverSig ? '✓ YES' : '✗ NO'}`);
        if (hasDriverSig) {
          console.log(`      Length: ${d.driverSignature.length} characters`);
        }
        
        console.log(`   Customer Signature: ${hasCustomerSig ? '✓ YES' : '✗ NO'}`);
        if (hasCustomerSig) {
          console.log(`      Length: ${d.customerSignature.length} characters`);
        }
        
        console.log(`   Photos: ${hasPhotos ? '✓ YES' : '✗ NO'}`);
        if (hasPhotos) {
          console.log(`      Count: ${d.photos.length}`);
          d.photos.forEach((photo, idx) => {
            if (typeof photo === 'string') {
              console.log(`      Photo ${idx + 1}: ${photo.substring(0, 50)}... (${photo.length} chars)`);
            } else if (photo && photo.data) {
              console.log(`      Photo ${idx + 1}: ${photo.data.substring(0, 50)}... (${photo.data.length} chars)`);
              if (photo.name) console.log(`         Name: ${photo.name}`);
            }
          });
        }
        
        if (d.deliveryNotes) {
          console.log(`   Delivery Notes: ${d.deliveryNotes}`);
        }
        if (d.conditionNotes) {
          console.log(`   Condition Notes: ${d.conditionNotes}`);
        }
        
        console.log('');
      });
    }

    // Summary
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                         SUMMARY                                ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    
    console.log(`📊 Statistics:`);
    console.log(`   Total Deliveries: ${totalDeliveries}`);
    console.log(`   Delivered: ${deliveredCount}`);
    console.log(`   With POD Data: ${withPODCount}`);
    console.log(`   Without POD: ${deliveredCount - withPODCount}`);
    console.log('');

    if (withPODCount === 0) {
      console.log('⚠️  ISSUE IDENTIFIED:');
      console.log('   POD images are NOT being saved to database!');
      console.log('');
      console.log('🔧 Possible causes:');
      console.log('   1. Driver portal POD upload not working');
      console.log('   2. API endpoint not saving data correctly');
      console.log('   3. Frontend not sending data in correct format');
      console.log('   4. Database schema issue');
      console.log('');
      console.log('📋 Next steps:');
      console.log('   1. Check driver portal POD upload component');
      console.log('   2. Check API endpoint: PUT /admin/deliveries/:id/status');
      console.log('   3. Test POD upload manually');
      console.log('');
    } else {
      console.log('✅ POD DATA IS BEING SAVED!');
      console.log('');
      console.log('🔧 If report shows 0, check:');
      console.log('   1. Report date filters');
      console.log('   2. Report query logic');
      console.log('   3. Frontend report component');
      console.log('');
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
}

checkPODData().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
