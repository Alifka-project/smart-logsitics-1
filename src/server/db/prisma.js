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
console.log('[Prisma Init] DATABASE_URL is', databaseUrl ? 'SET' : 'NOT SET');
console.log('[Prisma Init] NODE_ENV:', process.env.NODE_ENV);
console.log('[Prisma Init] VERCEL:', process.env.VERCEL ? 'yes' : 'no');

if (!databaseUrl) {
  console.error('❌ CRITICAL: DATABASE_URL is NOT set in environment!');
  console.error('Available database env vars:', Object.keys(process.env).filter(k => k.includes('DATABASE') || k.includes('POSTGRES')));
}

// Singleton pattern for serverless environments (prevents connection pool exhaustion)
let prisma;
let initError = null;

if (global.prisma) {
  console.log('[Prisma Init] Using existing global prisma instance');
  prisma = global.prisma;
} else {
  try {
    const clientOptions = {
      log: ['error'],
      errorFormat: 'pretty',
    };
    
    // Add connection timeout for production
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
      clientOptions.connectionTimeout = 10000; // 10 seconds
    }
    
    console.log('[Prisma Init] Creating new PrismaClient with options:', clientOptions);
    prisma = new PrismaClient(clientOptions);
    console.log('✅ Prisma Client created successfully');
    
    // In serverless, store in global to reuse across function invocations
    if (typeof global !== 'undefined') {
      global.prisma = prisma;
      console.log('[Prisma Init] Stored prisma in global for reuse');
    }
  } catch (err) {
    console.error('❌ Prisma Client initialization error:', err.message);
    console.error('[Prisma Init] Error code:', err.code);
    console.error('[Prisma Init] Error:', err.toString());
    initError = err;
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

// Export with error info
if (!prisma) {
  console.error('⚠️  WARNING: Prisma client is NULL!');
  if (initError) {
    console.error('Init error:', initError.message);
  }
}

module.exports = prisma;

