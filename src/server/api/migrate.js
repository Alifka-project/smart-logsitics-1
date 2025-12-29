/**
 * One-time migration endpoint
 * Call this ONCE to create all database tables
 * DELETE THIS FILE after migration is complete
 */

const express = require('express');
const router = express.Router();
const prisma = require('../db/prisma');

// POST /api/migrate - Create all tables (ONE TIME USE)
router.post('/migrate', async (req, res) => {
  try {
    console.log('🚀 Starting database migration...');

    // Enable pgcrypto extension
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    // STEP 1: Drop old/unnecessary tables FIRST (order matters due to foreign keys)
    console.log('🗑️  Dropping old tables...');
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS sms_confirmations CASCADE;`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS delivery_events CASCADE;`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS delivery_assignments CASCADE;`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS deliveries CASCADE;`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS live_locations CASCADE;`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS driver_status CASCADE;`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS driver_profiles CASCADE;`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS vehicles CASCADE;`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS driver_accounts CASCADE;`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS accounts CASCADE;`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS drivers CASCADE;`).catch(() => {});

    console.log('✅ Old tables dropped');

    // STEP 2: Create drivers table
    console.log('📦 Creating drivers table...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE drivers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        username varchar(100) UNIQUE,
        email varchar(255),
        phone varchar(32),
        full_name varchar(200),
        active boolean DEFAULT true,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
    `);

    // STEP 3: Create accounts table (NEW - optimized, replaces driver_accounts)
    console.log('📦 Creating accounts table...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        driver_id uuid REFERENCES drivers(id) ON DELETE CASCADE,
        password_hash text,
        last_login timestamptz,
        role varchar(50) DEFAULT 'driver',
        created_at timestamptz DEFAULT now()
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX accounts_driver_id_key ON accounts(driver_id);`);

    // STEP 4: Create driver_status table
    console.log('📦 Creating driver_status table...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE driver_status (
        driver_id uuid PRIMARY KEY REFERENCES drivers(id),
        status varchar(32) NOT NULL,
        updated_at timestamptz DEFAULT now(),
        current_assignment_id uuid
      );
    `);

    // STEP 5: Create live_locations table
    console.log('📦 Creating live_locations table...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE live_locations (
        id bigserial PRIMARY KEY,
        driver_id uuid REFERENCES drivers(id) ON DELETE CASCADE,
        latitude double precision NOT NULL,
        longitude double precision NOT NULL,
        heading double precision,
        speed double precision,
        accuracy double precision,
        recorded_at timestamptz DEFAULT now()
      );
    `);
    await prisma.$executeRawUnsafe(`CREATE INDEX idx_live_locations_driver_time ON live_locations(driver_id, recorded_at DESC);`);
    await prisma.$executeRawUnsafe(`CREATE INDEX idx_live_locations_time ON live_locations(recorded_at);`);

    // STEP 6: Create deliveries table
    console.log('📦 Creating deliveries table...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE deliveries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid()
      );
    `);

    // STEP 7: Create delivery_assignments table (optimized - no route_chunk)
    console.log('📦 Creating delivery_assignments table...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE delivery_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        delivery_id uuid REFERENCES deliveries(id) ON DELETE CASCADE,
        driver_id uuid REFERENCES drivers(id),
        assigned_at timestamptz DEFAULT now(),
        status varchar(32) DEFAULT 'assigned',
        eta timestamptz
      );
    `);

    // STEP 8: Create delivery_events table
    console.log('📦 Creating delivery_events table...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE delivery_events (
        id bigserial PRIMARY KEY,
        delivery_id uuid REFERENCES deliveries(id),
        event_type varchar(64),
        payload jsonb,
        created_at timestamptz DEFAULT now(),
        actor_type varchar(32),
        actor_id uuid
      );
    `);

    // STEP 9: Create sms_confirmations table
    console.log('📦 Creating sms_confirmations table...');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE sms_confirmations (
        id bigserial PRIMARY KEY,
        delivery_id uuid REFERENCES deliveries(id),
        phone varchar(32),
        provider varchar(50),
        message_id varchar(128),
        status varchar(32),
        attempts integer DEFAULT 0,
        last_status_at timestamptz,
        created_at timestamptz DEFAULT now(),
        metadata jsonb
      );
    `);

    console.log('✅ All tables created successfully!');

    res.json({ 
      success: true, 
      message: 'All tables created successfully!',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// POST /api/migrate/seed - Create default users
router.post('/seed', async (req, res) => {
  try {
    const { hashPassword } = require('../auth');
    
    // Create admin user
    const adminUsername = process.env.ADMIN_USER || 'Admin';
    const adminPassword = process.env.ADMIN_PASS || 'Admin123';
    
    const existingAdmin = await prisma.driver.findUnique({
      where: { username: adminUsername }
    });

    if (!existingAdmin) {
      const adminPasswordHash = await hashPassword(adminPassword);
      await prisma.$transaction(async (tx) => {
        const driver = await tx.driver.create({
          data: {
            username: adminUsername,
            email: 'admin@dubailogistics.com',
            fullName: 'Administrator',
            account: {
              create: {
                passwordHash: adminPasswordHash,
                role: 'admin'
              }
            }
          }
        });
      });
    }

    // Create driver user
    const driverUsername = process.env.DRIVER_USER || 'Driver1';
    const driverPassword = process.env.DRIVER_PASS || 'Driver123';
    
    const existingDriver = await prisma.driver.findUnique({
      where: { username: driverUsername }
    });

    if (!existingDriver) {
      const driverPasswordHash = await hashPassword(driverPassword);
      await prisma.$transaction(async (tx) => {
        const driver = await tx.driver.create({
          data: {
            username: driverUsername,
            fullName: 'Driver One',
            account: {
              create: {
                passwordHash: driverPasswordHash,
                role: 'driver'
              }
            }
          }
        });
      });
    }

    res.json({ 
      success: true, 
      message: 'Default users created successfully!',
      users: {
        admin: { username: adminUsername, password: adminPassword },
        driver: { username: driverUsername, password: driverPassword }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Seed error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;

