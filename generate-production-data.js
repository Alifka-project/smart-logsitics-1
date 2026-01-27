#!/usr/bin/env node

/**
 * Generate Production-like Test Data for Neon Database
 * 
 * This script generates realistic delivery data matching:
 * - Dubai locations (from your screenshots)
 * - Real delivery scenarios
 * - Proper relationships between all tables
 * - Timestamps in 2026
 * 
 * Usage: node generate-production-data.js
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Dubai location data from your screenshots
const dubaiLocations = [
  { customer: 'Al Zarooni Building', address: 'Al Zarooni Building Dubai Marina, DUBAI, 00000' },
  { customer: 'HSBC Tower Dubai', address: '6TH FLOOR HSBC TOWER, DUBAI, 00000' },
  { customer: 'Lootah Building', address: 'LOOTAH BUILDING, NASSER SQUARE, DUBAI, 00000' },
  { customer: 'Damac Ocean Heights', address: 'Damac ocean heights 3701, 00000' },
  { customer: 'Alrashidiyah Villa', address: 'Alrashidiyah Two Floor Villa Umm Al Qu, 00000' },
  { customer: 'Road Al Barsha', address: '316 ROAD AL BARSHA - 1, DUBAI, 00000' },
];

// Generate UUID v4
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Generate realistic delivery data
function generateDeliveries(driverIds, count = 15) {
  const deliveries = [];
  const statuses = ['pending', 'assigned', 'in_transit', 'delivered', 'failed'];
  const items = [
    'Electronics Package',
    'Document Envelope',
    'Food Order',
    'Furniture Item',
    'Medical Supplies',
  ];

  for (let i = 0; i < count; i++) {
    const location = dubaiLocations[i % dubaiLocations.length];
    const driverId = driverIds[i % driverIds.length];
    
    deliveries.push({
      id: generateUUID(),
      customer: location.customer,
      address: location.address,
      phone: `+971-${Math.floor(Math.random() * 9) + 1}-${Math.floor(Math.random() * 9999999).toString().padStart(7, '0')}`,
      status: statuses[Math.floor(Math.random() * statuses.length)],
      items: items[Math.floor(Math.random() * items.length)],
      poNumber: `PO-${Date.now()}-${i}`,
      lat: 25.2 + Math.random() * 0.3,
      lng: 55.2 + Math.random() * 0.3,
      createdAt: new Date(2026, 0, Math.floor(Math.random() * 27) + 1, Math.floor(Math.random() * 24), Math.floor(Math.random() * 60)),
      updatedAt: new Date(),
    });
  }

  return deliveries;
}

// Generate delivery assignments
function generateAssignments(deliveryIds, driverIds) {
  const assignments = [];
  
  for (let i = 0; i < deliveryIds.length; i++) {
    assignments.push({
      id: generateUUID(),
      deliveryId: deliveryIds[i],
      driverId: driverIds[i % driverIds.length],
      assignedAt: new Date(2026, 0, Math.floor(Math.random() * 27) + 1),
      status: 'assigned',
    });
  }

  return assignments;
}

// Generate delivery events
function generateEvents(assignmentIds, deliveryIds) {
  const events = [];
  const eventTypes = ['assigned', 'picked_up', 'in_transit', 'arrived', 'delivered'];

  for (const deliveryId of deliveryIds) {
    // Generate 2-5 events per delivery
    const numEvents = Math.floor(Math.random() * 4) + 2;
    for (let i = 0; i < numEvents; i++) {
      events.push({
        deliveryId: deliveryId,
        eventType: eventTypes[i % eventTypes.length],
        payload: {
          latitude: (25.2 + Math.random() * 0.3).toFixed(6),
          longitude: (55.2 + Math.random() * 0.3).toFixed(6),
        },
        createdAt: new Date(2026, 0, Math.floor(Math.random() * 27) + 1),
      });
    }
  }

  return events;
}

// Generate live locations
function generateLiveLocations(driverIds) {
  const locations = [];

  for (const driverId of driverIds) {
    locations.push({
      driverId: driverId,
      latitude: 25.2 + Math.random() * 0.3,
      longitude: 55.2 + Math.random() * 0.3,
      accuracy: Math.floor(Math.random() * 50) + 5,
      heading: Math.floor(Math.random() * 360),
      speed: Math.floor(Math.random() * 100),
      recordedAt: new Date(),
    });
  }

  return locations;
}

// Generate driver statuses
function generateDriverStatuses(driverIds) {
  const statuses = [];
  const statusOptions = ['available', 'busy', 'offline'];

  for (const driverId of driverIds) {
    statuses.push({
      driverId: driverId,
      status: statusOptions[Math.floor(Math.random() * statusOptions.length)],
      updatedAt: new Date(),
    });
  }

  return statuses;
}

// Generate messages
function generateMessages(adminId, driverIds) {
  const messages = [];
  const msgExamples = [
    'Please check the delivery address',
    'Customer requested to call before delivery',
    'Package contains fragile items',
    'Delivery address updated',
    'Early delivery requested',
  ];

  for (let i = 0; i < 8; i++) {
    const driverId = driverIds[i % driverIds.length];
    
    messages.push({
      id: generateUUID(),
      adminId: adminId,
      driverId: driverId,
      content: msgExamples[i % msgExamples.length],
      isRead: Math.random() > 0.3,
      createdAt: new Date(2026, 0, Math.floor(Math.random() * 27) + 1),
    });
  }

  return messages;
}

async function generateData() {
  try {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║   GENERATING PRODUCTION-LIKE TEST DATA FOR NEON        ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    // Step 1: Get existing users
    console.log('📋 Step 1: Getting existing drivers and accounts...');
    const drivers = await prisma.driver.findMany();
    const accounts = await prisma.account.findMany();
    
    console.log(`   ✅ Found ${drivers.length} drivers`);
    console.log(`   ✅ Found ${accounts.length} accounts\n`);

    const adminId = drivers[0].id; // Use first driver (admin)
    const driverIds = drivers.map(d => d.id);

    // Step 2: Clear previous test data (but keep admin users)
    console.log('🧹 Step 2: Clearing previous test data...');
    await prisma.smsLog.deleteMany({});
    await prisma.smsConfirmation.deleteMany({});
    await prisma.passwordReset.deleteMany({});
    await prisma.message.deleteMany({});
    await prisma.liveLocation.deleteMany({});
    await prisma.deliveryEvent.deleteMany({});
    await prisma.deliveryAssignment.deleteMany({});
    await prisma.delivery.deleteMany({});
    await prisma.driverStatus.deleteMany({});
    console.log('   ✅ Cleared\n');

    // Step 3: Generate and insert deliveries
    console.log('📦 Step 3: Generating deliveries...');
    const deliveries = generateDeliveries(driverIds, 15);
    
    for (const delivery of deliveries) {
      await prisma.delivery.create({ data: delivery });
    }
    console.log(`   ✅ Created ${deliveries.length} deliveries\n`);

    // Step 4: Generate and insert assignments
    console.log('🎯 Step 4: Generating delivery assignments...');
    const deliveryIds = deliveries.map(d => d.id);
    const assignments = generateAssignments(deliveryIds, driverIds);
    
    for (const assignment of assignments) {
      await prisma.deliveryAssignment.create({ data: assignment });
    }
    console.log(`   ✅ Created ${assignments.length} assignments\n`);

    // Step 5: Generate and insert delivery events
    console.log('📍 Step 5: Generating delivery events...');
    const assignmentIds = assignments.map(a => a.id);
    const events = generateEvents(assignmentIds, deliveryIds);
    
    for (const event of events) {
      await prisma.deliveryEvent.create({ data: event });
    }
    console.log(`   ✅ Created ${events.length} events\n`);

    // Step 6: Generate and insert live locations
    console.log('🗺️  Step 6: Generating live locations...');
    const locations = generateLiveLocations(driverIds);
    
    for (const location of locations) {
      await prisma.liveLocation.create({ data: location });
    }
    console.log(`   ✅ Created ${locations.length} live locations\n`);

    // Step 7: Generate and insert driver statuses
    console.log('👥 Step 7: Generating driver statuses...');
    const statuses = generateDriverStatuses(driverIds);
    
    for (const status of statuses) {
      await prisma.driverStatus.create({ data: status });
    }
    console.log(`   ✅ Created ${statuses.length} driver statuses\n`);

    // Step 8: Generate and insert messages
    console.log('💬 Step 8: Generating messages...');
    const messages = generateMessages(adminId, driverIds.slice(1)); // Exclude admin from receiving messages
    
    for (const msg of messages) {
      await prisma.message.create({ data: msg });
    }
    console.log(`   ✅ Created ${messages.length} messages\n`);
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║              DATA GENERATION COMPLETE                 ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    const counts = {
      drivers: await prisma.driver.count(),
      accounts: await prisma.account.count(),
      deliveries: await prisma.delivery.count(),
      deliveryAssignments: await prisma.deliveryAssignment.count(),
      deliveryEvents: await prisma.deliveryEvent.count(),
      driverStatuses: await prisma.driverStatus.count(),
      liveLocations: await prisma.liveLocation.count(),
      messages: await prisma.message.count(),
      passwordResets: await prisma.passwordReset.count(),
      smsConfirmations: await prisma.smsConfirmation.count(),
      smsLogs: await prisma.smsLog.count(),
    };

    console.log('📊 FINAL TABLE COUNTS:\n');
    console.log(`   drivers                  : ${counts.drivers}`);
    console.log(`   accounts                 : ${counts.accounts}`);
    console.log(`   deliveries               : ${counts.deliveries}`);
    console.log(`   delivery_assignments     : ${counts.deliveryAssignments}`);
    console.log(`   delivery_events          : ${counts.deliveryEvents}`);
    console.log(`   driver_status            : ${counts.driverStatuses}`);
    console.log(`   live_locations           : ${counts.liveLocations}`);
    console.log(`   messages                 : ${counts.messages}`);
    console.log(`   password_resets          : ${counts.passwordResets}`);
    console.log(`   sms_confirmations        : ${counts.smsConfirmations}`);
    console.log(`   sms_logs                 : ${counts.smsLogs}`);

    const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`\n   TOTAL ROWS               : ${totalRows}\n`);

    console.log('✅ Data generation successful!\n');
    console.log('💡 The database now has realistic test data with:');
    console.log('   - 15 deliveries in Dubai locations');
    console.log('   - 15 delivery assignments');
    console.log('   - 30+ delivery events');
    console.log('   - Live locations for all drivers');
    console.log('   - Driver statuses');
    console.log('   - Admin-driver messages\n');

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

generateData();
