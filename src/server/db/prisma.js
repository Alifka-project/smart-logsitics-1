/**
 * Prisma Client Instance
 * Database is REQUIRED - All queries use Prisma
 * 
 * Prisma Client automatically reads DATABASE_URL from environment variables
 * Uses singleton pattern for serverless environments (Vercel)
 */

const { PrismaClient } = require('@prisma/client');

// Singleton pattern for serverless environments (prevents connection pool exhaustion)
let prisma;

if (global.prisma) {
  prisma = global.prisma;
} else {
  // Verify DATABASE_URL is set, but don't throw at module load in serverless
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    // In serverless, don't throw - let it fail gracefully on first query
    // This allows endpoints to return proper error responses
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      console.warn('WARNING: DATABASE_URL not set. Database queries will fail.');
    } else {
      // Only throw in development/local environments
      throw new Error('DATABASE_URL is required. Database integration is mandatory.');
    }
  }

  try {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
    
    // In serverless, store in global to reuse across function invocations
    if (typeof global !== 'undefined') {
      global.prisma = prisma;
    }
  } catch (err) {
    console.error('Failed to initialize Prisma Client:', err);
    console.error('Error details:', err.message);
    // Re-throw in development to catch configuration issues early
    if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
      throw err;
    }
    // In production/serverless, set to null and let endpoints handle gracefully
    prisma = null;
  }
}

// Handle graceful shutdown (only in non-serverless)
if (!process.env.VERCEL && prisma && typeof prisma.$disconnect === 'function') {
  process.on('beforeExit', async () => {
    try {
      await prisma.$disconnect();
    } catch (err) {
      console.error('Error disconnecting Prisma:', err);
    }
  });
}

module.exports = prisma;

