#!/usr/bin/env node

/**
 * Data Migration Script - Old Prisma to New Neon Database
 * 
 * This script will:
 * 1. Read exported data from a JSON file
 * 2. Insert all data into Neon database in correct order (respecting FK relationships)
 * 3. Verify data integrity and row counts
 * 
 * Usage: node migrate-data.js <path-to-exported-data.json>
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function migrateData(dataFilePath) {
  try {
    log('cyan', '\n╔════════════════════════════════════════════════════════╗');
    log('cyan', '║     DATA MIGRATION - OLD PRISMA TO NEON DATABASE      ║');
    log('cyan', '╚════════════════════════════════════════════════════════╝\n');

    // Read exported data
    if (!fs.existsSync(dataFilePath)) {
      log('red', `❌ Error: File not found: ${dataFilePath}`);
      process.exit(1);
    }

    log('blue', '📂 Reading exported data...');
    const exportedData = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
    log('green', '✅ Data file loaded\n');

    // Clear existing data (except user accounts if they're setup)
    log('yellow', '⚠️  Clearing existing data in Neon database...\n');
    
    // Delete in reverse order of dependencies
    await prisma.smsLog.deleteMany({});
    await prisma.smsConfirmation.deleteMany({});
    await prisma.passwordReset.deleteMany({});
    await prisma.message.deleteMany({});
    await prisma.liveLocation.deleteMany({});
    await prisma.deliveryEvent.deleteMany({});
    await prisma.deliveryAssignment.deleteMany({});
    await prisma.delivery.deleteMany({});
    await prisma.driverStatus.deleteMany({});
    // Keep drivers and accounts for now

    log('green', '✅ Database cleared\n');

    // Track counts for verification
    const insertedCounts = {
      drivers: 0,
      accounts: 0,
      deliveries: 0,
      deliveryAssignments: 0,
      deliveryEvents: 0,
      driverStatuses: 0,
      liveLocations: 0,
      messages: 0,
      passwordResets: 0,
      smsConfirmations: 0,
      smsLogs: 0,
    };

    const exportedCounts = {
      drivers: exportedData.drivers?.length || 0,
      accounts: exportedData.accounts?.length || 0,
      deliveries: exportedData.deliveries?.length || 0,
      deliveryAssignments: exportedData.deliveryAssignments?.length || 0,
      deliveryEvents: exportedData.deliveryEvents?.length || 0,
      driverStatuses: exportedData.driverStatuses?.length || 0,
      liveLocations: exportedData.liveLocations?.length || 0,
      messages: exportedData.messages?.length || 0,
      passwordResets: exportedData.passwordResets?.length || 0,
      smsConfirmations: exportedData.smsConfirmations?.length || 0,
      smsLogs: exportedData.smsLogs?.length || 0,
    };

    log('cyan', '📊 EXPORTED DATA COUNTS:\n');
    for (const [table, count] of Object.entries(exportedCounts)) {
      console.log(`   ${table.padEnd(25)}: ${count} rows`);
    }

    // Insert data in correct order (respecting foreign keys)
    log('cyan', '\n📥 INSERTING DATA INTO NEON:\n');

    // 1. Drivers
    if (exportedData.drivers && exportedData.drivers.length > 0) {
      log('blue', 'Inserting drivers...');
      for (const driver of exportedData.drivers) {
        try {
          await prisma.driver.create({ data: driver });
          insertedCounts.drivers++;
        } catch (err) {
          // Skip if already exists (same ID)
          if (!err.message.includes('Unique constraint')) {
            log('yellow', `⚠️  Error inserting driver ${driver.id}: ${err.message}`);
          }
        }
      }
      log('green', `✅ Drivers: ${insertedCounts.drivers}/${exportedCounts.drivers}`);
    }

    // 2. Accounts
    if (exportedData.accounts && exportedData.accounts.length > 0) {
      log('blue', 'Inserting accounts...');
      for (const account of exportedData.accounts) {
        try {
          await prisma.account.create({ data: account });
          insertedCounts.accounts++;
        } catch (err) {
          if (!err.message.includes('Unique constraint')) {
            log('yellow', `⚠️  Error inserting account ${account.id}: ${err.message}`);
          }
        }
      }
      log('green', `✅ Accounts: ${insertedCounts.accounts}/${exportedCounts.accounts}`);
    }

    // 3. Driver Status
    if (exportedData.driverStatuses && exportedData.driverStatuses.length > 0) {
      log('blue', 'Inserting driver statuses...');
      for (const status of exportedData.driverStatuses) {
        try {
          await prisma.driverStatus.create({ data: status });
          insertedCounts.driverStatuses++;
        } catch (err) {
          if (!err.message.includes('Unique constraint')) {
            log('yellow', `⚠️  Error inserting status ${status.id}: ${err.message}`);
          }
        }
      }
      log('green', `✅ Driver Statuses: ${insertedCounts.driverStatuses}/${exportedCounts.driverStatuses}`);
    }

    // 4. Deliveries
    if (exportedData.deliveries && exportedData.deliveries.length > 0) {
      log('blue', 'Inserting deliveries...');
      for (const delivery of exportedData.deliveries) {
        try {
          await prisma.delivery.create({ data: delivery });
          insertedCounts.deliveries++;
        } catch (err) {
          if (!err.message.includes('Unique constraint')) {
            log('yellow', `⚠️  Error inserting delivery ${delivery.id}: ${err.message}`);
          }
        }
      }
      log('green', `✅ Deliveries: ${insertedCounts.deliveries}/${exportedCounts.deliveries}`);
    }

    // 5. Delivery Assignments
    if (exportedData.deliveryAssignments && exportedData.deliveryAssignments.length > 0) {
      log('blue', 'Inserting delivery assignments...');
      for (const assignment of exportedData.deliveryAssignments) {
        try {
          await prisma.deliveryAssignment.create({ data: assignment });
          insertedCounts.deliveryAssignments++;
        } catch (err) {
          if (!err.message.includes('Unique constraint')) {
            log('yellow', `⚠️  Error inserting assignment ${assignment.id}: ${err.message}`);
          }
        }
      }
      log('green', `✅ Delivery Assignments: ${insertedCounts.deliveryAssignments}/${exportedCounts.deliveryAssignments}`);
    }

    // 6. Delivery Events
    if (exportedData.deliveryEvents && exportedData.deliveryEvents.length > 0) {
      log('blue', 'Inserting delivery events...');
      for (const event of exportedData.deliveryEvents) {
        try {
          await prisma.deliveryEvent.create({ data: event });
          insertedCounts.deliveryEvents++;
        } catch (err) {
          if (!err.message.includes('Unique constraint')) {
            log('yellow', `⚠️  Error inserting event ${event.id}: ${err.message}`);
          }
        }
      }
      log('green', `✅ Delivery Events: ${insertedCounts.deliveryEvents}/${exportedCounts.deliveryEvents}`);
    }

    // 7. Live Locations
    if (exportedData.liveLocations && exportedData.liveLocations.length > 0) {
      log('blue', 'Inserting live locations...');
      for (const location of exportedData.liveLocations) {
        try {
          await prisma.liveLocation.create({ data: location });
          insertedCounts.liveLocations++;
        } catch (err) {
          if (!err.message.includes('Unique constraint')) {
            log('yellow', `⚠️  Error inserting location ${location.id}: ${err.message}`);
          }
        }
      }
      log('green', `✅ Live Locations: ${insertedCounts.liveLocations}/${exportedCounts.liveLocations}`);
    }

    // 8. Messages
    if (exportedData.messages && exportedData.messages.length > 0) {
      log('blue', 'Inserting messages...');
      for (const message of exportedData.messages) {
        try {
          await prisma.message.create({ data: message });
          insertedCounts.messages++;
        } catch (err) {
          if (!err.message.includes('Unique constraint')) {
            log('yellow', `⚠️  Error inserting message ${message.id}: ${err.message}`);
          }
        }
      }
      log('green', `✅ Messages: ${insertedCounts.messages}/${exportedCounts.messages}`);
    }

    // 9. Password Resets
    if (exportedData.passwordResets && exportedData.passwordResets.length > 0) {
      log('blue', 'Inserting password resets...');
      for (const reset of exportedData.passwordResets) {
        try {
          await prisma.passwordReset.create({ data: reset });
          insertedCounts.passwordResets++;
        } catch (err) {
          if (!err.message.includes('Unique constraint')) {
            log('yellow', `⚠️  Error inserting reset ${reset.id}: ${err.message}`);
          }
        }
      }
      log('green', `✅ Password Resets: ${insertedCounts.passwordResets}/${exportedCounts.passwordResets}`);
    }

    // 10. SMS Confirmations
    if (exportedData.smsConfirmations && exportedData.smsConfirmations.length > 0) {
      log('blue', 'Inserting SMS confirmations...');
      for (const confirmation of exportedData.smsConfirmations) {
        try {
          await prisma.smsConfirmation.create({ data: confirmation });
          insertedCounts.smsConfirmations++;
        } catch (err) {
          if (!err.message.includes('Unique constraint')) {
            log('yellow', `⚠️  Error inserting confirmation ${confirmation.id}: ${err.message}`);
          }
        }
      }
      log('green', `✅ SMS Confirmations: ${insertedCounts.smsConfirmations}/${exportedCounts.smsConfirmations}`);
    }

    // 11. SMS Logs
    if (exportedData.smsLogs && exportedData.smsLogs.length > 0) {
      log('blue', 'Inserting SMS logs...');
      for (const log_ of exportedData.smsLogs) {
        try {
          await prisma.smsLog.create({ data: log_ });
          insertedCounts.smsLogs++;
        } catch (err) {
          if (!err.message.includes('Unique constraint')) {
            log('yellow', `⚠️  Error inserting SMS log ${log_.id}: ${err.message}`);
          }
        }
      }
      log('green', `✅ SMS Logs: ${insertedCounts.smsLogs}/${exportedCounts.smsLogs}`);
    }

    // Verification
    log('cyan', '\n\n╔════════════════════════════════════════════════════════╗');
    log('cyan', '║            MIGRATION VERIFICATION REPORT             ║');
    log('cyan', '╚════════════════════════════════════════════════════════╝\n');

    console.log('📊 COMPARISON - EXPORTED vs INSERTED:\n');
    console.log(`   ${'Table'.padEnd(25)} ${'Exported'.padEnd(12)} ${'Inserted'.padEnd(12)} ${'Status'}`);
    console.log('   ' + '─'.repeat(65));

    let allMatched = true;
    for (const [table, exportedCount] of Object.entries(exportedCounts)) {
      const insertedCount = insertedCounts[table];
      const matched = exportedCount === insertedCount;
      const status = matched ? '✅' : '❌';
      
      if (!matched) allMatched = false;
      
      console.log(
        `   ${table.padEnd(25)} ${exportedCount.toString().padEnd(12)} ${insertedCount.toString().padEnd(12)} ${status}`
      );
    }

    console.log('   ' + '─'.repeat(65));
    const totalExported = Object.values(exportedCounts).reduce((a, b) => a + b, 0);
    const totalInserted = Object.values(insertedCounts).reduce((a, b) => a + b, 0);
    console.log(`   ${'TOTAL'.padEnd(25)} ${totalExported.toString().padEnd(12)} ${totalInserted.toString().padEnd(12)} ${totalExported === totalInserted ? '✅' : '❌'}\n`);

    if (allMatched && totalExported === totalInserted) {
      log('green', '\n✅ MIGRATION SUCCESSFUL! All data has been transferred exactly.\n');
    } else {
      log('yellow', '\n⚠️  WARNING: Some data may not have been inserted. Check errors above.\n');
    }

  } catch (error) {
    log('red', `\n❌ MIGRATION FAILED: ${error.message}`);
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Main execution
const dataFile = process.argv[2];
if (!dataFile) {
  log('red', '\n❌ Error: Please provide path to exported data file');
  console.log('\nUsage: node migrate-data.js <path-to-exported-data.json>');
  console.log('\nExample: node migrate-data.js ./exported_data.json\n');
  process.exit(1);
}

migrateData(dataFile).then(() => {
  process.exit(0);
});
