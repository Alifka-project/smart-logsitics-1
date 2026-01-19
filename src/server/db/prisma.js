/**
 * Prisma Client Instance
 * Database is REQUIRED - All queries use Prisma
 * 
 * Prisma Client automatically reads DATABASE_URL from environment variables
 * Uses singleton pattern for serverless environments (Vercel)
 */

const { PrismaClient } = require('@prisma/client');

// Verify DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  // In serverless, don't throw - let it fail gracefully on first query
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL) {
    console.warn('WARNING: DATABASE_URL not set in Vercel production environment');
  }
}

// Singleton pattern for serverless environments (prevents connection pool exhaustion)
let prisma;

if (global.prisma) {
  prisma = global.prisma;
} else {
  prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
  
  // In serverless, store in global to reuse across function invocations
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    global.prisma = prisma;
  }
}

// Handle graceful shutdown (only in non-serverless)
if (!process.env.VERCEL) {
  process.on('beforeExit', async () => {
    await prisma.$disconnect();
  });
}

module.exports = prisma;

