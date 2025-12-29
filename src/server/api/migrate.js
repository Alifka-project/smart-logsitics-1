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
    // Enable pgcrypto extension
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

    // Create drivers table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS drivers (
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

    // Drop old tables if they exist (cleanup)
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS driver_profiles CASCADE;`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS vehicles CASCADE;`).catch(() => {});
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS driver_accounts CASCADE;`).catch(() => {});

    // Create accounts table (renamed from driver_accounts - simplified)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        driver_id uuid REFERENCES drivers(id) ON DELETE CASCADE,
        password_hash text,
        last_login timestamptz,
        role varchar(50) DEFAULT 'driver',
        created_at timestamptz DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS accounts_driver_id_key ON accounts(driver_id);
    `);

    // Create driver_status table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS driver_status (
        driver_id uuid PRIMARY KEY REFERENCES drivers(id),
        status varchar(32) NOT NULL,
        updated_at timestamptz DEFAULT now(),
        current_assignment_id uuid
      );
    `);

    // Create live_locations table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS live_locations (
        id bigserial PRIMARY KEY,
        driver_id uuid REFERENCES drivers(id) ON DELETE CASCADE,
        latitude double precision NOT NULL,
        longitude double precision NOT NULL,
        heading double precision,
        speed double precision,
        accuracy double precision,
        recorded_at timestamptz DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_live_locations_driver_time ON live_locations(driver_id, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_live_locations_time ON live_locations(recorded_at);
    `);

    // Create deliveries table (minimal)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS deliveries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid()
      );
    `);

    // Create delivery_assignments table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS delivery_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        delivery_id uuid REFERENCES deliveries(id) ON DELETE CASCADE,
        driver_id uuid REFERENCES drivers(id),
        assigned_at timestamptz DEFAULT now(),
        status varchar(32) DEFAULT 'assigned',
        eta timestamptz,
        route_chunk integer DEFAULT 0
      );
    `);

    // Create delivery_events table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS delivery_events (
        id bigserial PRIMARY KEY,
        delivery_id uuid REFERENCES deliveries(id),
        event_type varchar(64),
        payload jsonb,
        created_at timestamptz DEFAULT now(),
        actor_type varchar(32),
        actor_id uuid
      );
    `);

    // Create sms_confirmations table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS sms_confirmations (
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

