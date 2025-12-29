/**
 * Script to create default admin and driver accounts
 * Run with: node scripts/create-default-users.js
 * 
 * Note: Make sure the database is running and environment variables are set
 */

// Load environment variables (optional)
try {
  const path = require('path');
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
  // dotenv may not be needed if env vars are set
}

const db = require('../src/server/db');
const { hashPassword } = require('../src/server/auth');

async function createDefaultUsers() {
  try {
    console.log('Connecting to database...');
    
    // Test database connection
    await db.query('SELECT 1');
    console.log('✓ Database connection successful\n');
    
    // Admin account
    const adminUsername = 'admin';
    const adminPassword = 'admin123';
    const adminEmail = 'admin@dubailogistics.com';
    const adminFullName = 'System Administrator';
    
    // Driver account
    const driverUsername = 'driver1';
    const driverPassword = 'driver123';
    const driverEmail = 'driver1@dubailogistics.com';
    const driverFullName = 'Test Driver';
    
    // Check if admin already exists
    const adminCheck = await db.query('SELECT id FROM drivers WHERE username = $1', [adminUsername]);
    if (adminCheck.rows.length > 0) {
      console.log(`✓ Admin user '${adminUsername}' already exists`);
    } else {
      // Create admin driver
      const adminDriver = await db.query(
        'INSERT INTO drivers(username, email, full_name) VALUES($1, $2, $3) RETURNING id',
        [adminUsername, adminEmail, adminFullName]
      );
      const adminId = adminDriver.rows[0].id;
      
      // Hash password
      const adminPasswordHash = await hashPassword(adminPassword);
      
      // Create admin account
      await db.query(
        'INSERT INTO driver_accounts(driver_id, password_hash, role) VALUES($1, $2, $3)',
        [adminId, adminPasswordHash, 'admin']
      );
      
      console.log(`✓ Created admin user:`);
      console.log(`  Username: ${adminUsername}`);
      console.log(`  Password: ${adminPassword}`);
    }
    
    // Check if driver already exists
    const driverCheck = await db.query('SELECT id FROM drivers WHERE username = $1', [driverUsername]);
    if (driverCheck.rows.length > 0) {
      console.log(`✓ Driver user '${driverUsername}' already exists`);
    } else {
      // Create driver
      const driverDriver = await db.query(
        'INSERT INTO drivers(username, email, full_name) VALUES($1, $2, $3) RETURNING id',
        [driverUsername, driverEmail, driverFullName]
      );
      const driverId = driverDriver.rows[0].id;
      
      // Hash password
      const driverPasswordHash = await hashPassword(driverPassword);
      
      // Create driver account
      await db.query(
        'INSERT INTO driver_accounts(driver_id, password_hash, role) VALUES($1, $2, $3)',
        [driverId, driverPasswordHash, 'driver']
      );
      
      console.log(`✓ Created driver user:`);
      console.log(`  Username: ${driverUsername}`);
      console.log(`  Password: ${driverPassword}`);
    }
    
    console.log('\n✅ Default users created successfully!');
    console.log('\n📋 Login Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('👤 ADMIN ACCOUNT:');
    console.log('   Username: admin');
    console.log('   Password: admin123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🚗 DRIVER ACCOUNT:');
    console.log('   Username: driver1');
    console.log('   Password: driver123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n⚠️  IMPORTANT: Change these passwords after first login!');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error creating default users:');
    console.error(error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Make sure the database server is running!');
      console.error('   Run: docker-compose up -d db');
    } else if (error.code === '42P01') {
      console.error('\n💡 Make sure database tables exist!');
      console.error('   Run the migration: psql -d postgres -f db/migrations/001_create_drivers_and_locations.sql');
    }
    process.exit(1);
  }
}

createDefaultUsers();
