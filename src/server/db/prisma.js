/**
 * Prisma Client Instance
 * Database is REQUIRED - All queries use Prisma
 */

const { PrismaClient } = require('@prisma/client');

// Get connection string from environment
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  throw new Error('DATABASE_URL is required. Database integration is mandatory.');
}

// Check if using Prisma Accelerate (connection string starts with 'prisma+postgres://')
const isAccelerate = databaseUrl.startsWith('prisma+postgres://');

const prisma = new PrismaClient({
  // Use adapter for direct connection or accelerateUrl for Accelerate
  ...(isAccelerate 
    ? { accelerateUrl: databaseUrl }
    : { adapter: 'postgresql', connectionString: databaseUrl }
  ),
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Handle graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

module.exports = prisma;

