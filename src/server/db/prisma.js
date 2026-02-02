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

if (!databaseUrl) {
  console.warn('⚠️  WARNING: DATABASE_URL environment variable not set');
  console.warn('This is OK during build, but required at runtime');
  console.warn('Set DATABASE_URL in Vercel Environment Variables to your direct Postgres connection');
  
  // During build or if DATABASE_URL is missing, we'll create a dummy connection
  // This prevents build failures - real errors will occur at runtime
  if (process.env.NODE_ENV !== 'development' && !process.env.npm_lifecycle_event?.includes('build')) {
    console.error('🚨 CRITICAL: DATABASE_URL is required for runtime');
    console.error('Example: postgres://user:password@host:5432/database?sslmode=require');
  }
}

// Log database connection info for debugging
console.log('Database Configuration:');
console.log('- DATABASE_URL:', databaseUrl ? 'SET (' + databaseUrl.substring(0, 40) + '...)' : 'NOT SET');
console.log('- NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('- VERCEL:', process.env.VERCEL ? 'yes' : 'no');
console.log('- Build phase:', process.env.npm_lifecycle_event || 'runtime');

// Singleton pattern for serverless environments (prevents connection pool exhaustion)
let prisma;
let initError = null;

if (global.prisma) {
  prisma = global.prisma;
} else {
  try {
    const clientOptions = {
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
      errorFormat: 'pretty',
    };
    
    // Add connection timeout and retry logic for production
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
      clientOptions.connectionTimeout = 10000; // 10 seconds
    }
    
    prisma = new PrismaClient(clientOptions);
    console.log('✅ Prisma Client initialized successfully');
    
    // In serverless, store in global to reuse across function invocations
    if (typeof global !== 'undefined') {
      global.prisma = prisma;
    }
  } catch (err) {
    console.error('⚠️  Prisma Client initialization error:', err.message);
    if (databaseUrl) {
      console.error('Error details:', err);
    }
    initError = err;
    // In development or build phase, don't fail
    if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
      // Allow to continue - will fail on actual queries if db is needed
      console.warn('Continuing without database connection...');
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

// Export with helpful error info
if (!prisma && initError) {
  console.warn('Prisma initialization error info:', {
    error: initError.message,
    code: initError.code,
    dbUrl: process.env.DATABASE_URL ? 'SET' : 'NOT_SET',
    prismaDbUrl: process.env.PRISMA_DATABASE_URL ? 'SET' : 'NOT_SET',
  });
}

module.exports = prisma;

