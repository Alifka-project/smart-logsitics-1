/**
 * Prisma Client Instance
 * Database is REQUIRED - All queries use Prisma
 * 
 * Prisma Client automatically reads DATABASE_URL from environment variables
 * Uses singleton pattern for serverless environments (Vercel)
 */

const { PrismaClient } = require('@prisma/client');

// Verify DATABASE_URL is set
if (!process.env.DATABASE_URL && !process.env.PRISMA_DATABASE_URL) {
  console.error('CRITICAL: DATABASE_URL or PRISMA_DATABASE_URL environment variable is required');
  console.error('Make sure DATABASE_URL is set in Vercel Environment Variables');
  console.error('Current env vars:', Object.keys(process.env).filter(k => k.includes('DATABASE') || k.includes('PRISMA')));
  // In production, throw error so deployment logs show it
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required. Configure in Vercel Settings → Environment Variables');
  }
}

// Singleton pattern for serverless environments (prevents connection pool exhaustion)
let prisma;

if (global.prisma) {
  prisma = global.prisma;
} else {
  try {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
    
    // In serverless, store in global to reuse across function invocations
    if (typeof global !== 'undefined') {
      global.prisma = prisma;
    }
  } catch (err) {
    console.error('CRITICAL: Failed to initialize Prisma Client:', err.message);
    throw err;
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

