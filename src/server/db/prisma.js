/**
 * Prisma Client Instance
 * Database is REQUIRED - All queries use Prisma
 * 
 * Prisma Client automatically reads DATABASE_URL from environment variables
 * Uses singleton pattern for serverless environments (Vercel)
 */

const { PrismaClient } = require('@prisma/client');

// Use DATABASE_URL for direct connection (standard Prisma setup)
const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

console.log('[Prisma Init] Starting initialization...');
console.log('[Prisma Init] DATABASE_URL is', databaseUrl ? 'SET (length: ' + databaseUrl.length + ')' : 'NOT SET');
console.log('[Prisma Init] NODE_ENV:', process.env.NODE_ENV);
console.log('[Prisma Init] VERCEL:', process.env.VERCEL ? 'yes' : 'no');

// Singleton pattern for serverless environments (prevents connection pool exhaustion)
let prisma;
let initError = null;

if (global.prisma) {
  console.log('[Prisma Init] Using existing global prisma instance');
  prisma = global.prisma;
} else {
  try {
    console.log('[Prisma Init] Creating new PrismaClient...');
    
    prisma = new PrismaClient({
      log: ['error', 'warn'],
      errorFormat: 'pretty',
    });
    
    console.log('✅ [Prisma Init] PrismaClient created successfully');
    
    // In serverless, store in global to reuse across function invocations
    if (typeof global !== 'undefined') {
      global.prisma = prisma;
      console.log('[Prisma Init] Stored prisma in global for reuse');
    }
  } catch (err) {
    console.error('❌ [Prisma Init] FAILED TO CREATE PRISMA CLIENT');
    console.error('[Prisma Init] Error message:', err.message);
    console.error('[Prisma Init] Error code:', err.code);
    console.error('[Prisma Init] Error name:', err.name);
    console.error('[Prisma Init] Full error:', err.toString());
    console.error('[Prisma Init] Stack trace:', err.stack);
    initError = err;
    prisma = null;
    
    // THROW in development/vercel to see the error
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      console.error('[Prisma Init] CRITICAL: Throwing error in production/Vercel');
      throw err;
    }
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

