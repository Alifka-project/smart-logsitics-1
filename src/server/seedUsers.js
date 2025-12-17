const db = require('./db');
const { hashPassword } = require('./auth');

async function ensureUser(username, password, role, email, fullName) {
  try {
    const { rows } = await db.query('SELECT id FROM drivers WHERE username = $1 LIMIT 1', [username]);
    if (rows.length) {
      console.log(`User ${username} already exists`);
      return;
    }
    const insert = await db.query('INSERT INTO drivers(username, email, phone, full_name) VALUES($1,$2,$3,$4) RETURNING id', [username, email || null, null, fullName || username]);
    const driverId = insert.rows[0].id;
    const pwHash = await hashPassword(password);
    await db.query('INSERT INTO driver_accounts(driver_id, password_hash, role) VALUES($1,$2,$3)', [driverId, pwHash, role]);
    console.log(`Seeded user ${username} with role ${role}`);
  } catch (err) {
    console.error('ensureUser error', err);
    throw err;
  }
}

async function run() {
  try {
    const adminUser = process.env.ADMIN_USER || 'Admin';
    const adminPass = process.env.ADMIN_PASS || 'Admin123';
    const driverUser = process.env.DRIVER_USER || 'Driver1';
    const driverPass = process.env.DRIVER_PASS || 'Driver123';

    await ensureUser(adminUser, adminPass, 'admin', 'admin@example.com', 'Administrator');
    await ensureUser(driverUser, driverPass, 'driver', null, 'Driver One');
  } catch (e) {
    console.error('seed run failed', e);
  } finally {
    process.exit(0);
  }
}

run();
