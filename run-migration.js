const { Client } = require('pg');
const fs = require('fs');

const client = new Client({
  connectionString: "postgres://6a81efaf74f4a117a2bd64fd43af9aae5ad5209628abe313dc93933e468e2a64:sk_ayxWM3HTphNUmIhEUYv__@db.prisma.io:5432/postgres?sslmode=require"
});

async function runMigration() {
  try {
    await client.connect();
    console.log('Connected to database');

    const migrationSQL = fs.readFileSync('./prisma/migrations/add_sms_fields/migration.sql', 'utf8');
    
    // Split by semicolon and execute each statement
    const statements = migrationSQL.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      try {
        console.log(`Executing: ${statement.substring(0, 50)}...`);
        await client.query(statement);
      } catch (err) {
        // Ignore "already exists" errors
        if (err.message.includes('already exists') || err.message.includes('duplicate')) {
          console.log(`  ↳ Already exists (skipping)`);
        } else {
          console.error(`  ↳ Error: ${err.message}`);
        }
      }
    }

    console.log('\n✅ Migration completed!');
  } catch (err) {
    console.error('Failed to connect:', err);
  } finally {
    await client.end();
  }
}

runMigration();
