const db = require('./db');
const { hashPassword } = require('./auth');

async function seed() {
  try {
    const username = process.env.ADMIN_USER || 'admin';
    const password = process.env.ADMIN_PASS || 'adminpass';
    const email = process.env.ADMIN_EMAIL || 'admin@example.com';

    // Check if admin exists
    const { rows } = await db.query('SELECT id FROM drivers WHERE username = $1 LIMIT 1', [username]);
    if (rows.length) {
      console.log('Admin user already exists');
      return;
    }

    const insert = await db.query('INSERT INTO drivers(username, email, phone, full_name) VALUES($1,$2,$3,$4) RETURNING id', [username, email, null, 'Administrator']);
    const driverId = insert.rows[0].id;
    const pwHash = await hashPassword(password);
    await db.query('INSERT INTO driver_accounts(driver_id, password_hash, role) VALUES($1,$2,$3)', [driverId, pwHash, 'admin']);
    console.log('Seeded admin:', username);
  } catch (err) {
    console.error('seed error', err);
  } finally {
    process.exit(0);
  }
}

seed();
