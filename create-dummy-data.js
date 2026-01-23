const { Client } = require('pg');
const crypto = require('crypto');

const client = new Client({
  connectionString: "postgres://6a81efaf74f4a117a2bd64fd43af9aae5ad5209628abe313dc93933e468e2a64:sk_ayxWM3HTphNUmIhEUYv__@db.prisma.io:5432/postgres?sslmode=require"
});

// Helper to generate UUID v4
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Helper to generate confirmation token
function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

async function createDummyData() {
  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Create dummy delivery
    const deliveryId = generateUUID();
    const confirmationToken = generateToken();
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours from now

    const deliverySQL = `
      INSERT INTO deliveries (
        id, 
        customer, 
        address, 
        phone, 
        status, 
        items,
        "confirmationToken",
        "confirmationStatus",
        "token_expires_at",
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()
      )
      ON CONFLICT (id) DO NOTHING
    `;

    await client.query(deliverySQL, [
      deliveryId,
      'John Smith - Test Customer',
      '123 Main Street, Downtown, Test City',
      '+1-555-123-4567',
      'pending',
      'Test Delivery Item',
      confirmationToken,
      'pending',
      expiresAt
    ]);

    console.log('\n📦 Dummy Delivery Created:');
    console.log('   ID:', deliveryId);
    console.log('   Customer: John Smith - Test Customer');
    console.log('   Phone: +1-555-123-4567');
    console.log('   Address: 123 Main Street, Downtown, Test City');

    console.log('\n📱 SMS Confirmation Token:', confirmationToken);
    console.log('   Expires at:', expiresAt.toISOString());

    console.log('\n🔗 Test Links:');
    console.log('\n1️⃣ Confirmation Page (Customer confirms delivery):');
    console.log(`   https://smart-logistics-1.vercel.app/confirm-delivery/${confirmationToken}`);

    console.log('\n2️⃣ Tracking Page (Real-time tracking):');
    console.log(`   https://smart-logistics-1.vercel.app/customer-tracking/${confirmationToken}`);

    console.log('\n3️⃣ Simple Tracking (By Delivery ID):');
    console.log(`   https://smart-logistics-1.vercel.app/track/${deliveryId}`);

    console.log('\n✅ Done! Copy the links above and test the customer pages!');

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.end();
  }
}

createDummyData();
