/**
 * Prisma Client Instance
 * Database is REQUIRED - All queries use Prisma
 *
 * Prisma Client automatically reads DATABASE_URL from environment variables
 * Uses singleton pattern for serverless environments (Vercel)
 */

import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | null | undefined;
}

// Resolve the best available database URL.
// Priority: DATABASE_URL → POSTGRES_URL → PRISMA_DATABASE_URL (direct, not Accelerate)
// PRISMA_DATABASE_URL may be an Accelerate URL (prisma+postgres://) which is NOT
// usable without @prisma/extension-accelerate, so skip it when it uses that protocol.
function resolveDbUrl(): string | undefined {
  const candidates = [
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
    process.env.PRISMA_DATABASE_URL,
  ];
  for (const url of candidates) {
    if (url && !url.startsWith('prisma+postgres://')) return url;
  }
  return undefined;
}

/**
 * On Vercel (serverless), each function invocation must be limited to a single
 * DB connection. Without this, concurrent cold-start invocations each open a
 * full Prisma connection pool and quickly exhaust Neon's connection cap,
 * causing Prisma's $connect() to hang → Vercel function timeout → 503.
 *
 * We append connection_limit=1&pool_timeout=10 when running on Vercel and
 * those params are not already present in the URL.
 */
function addServerlessParams(url: string): string {
  if (!url || !process.env.VERCEL) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '1');
    if (!u.searchParams.has('pool_timeout'))     u.searchParams.set('pool_timeout', '10');
    return u.toString();
  } catch {
    // URL constructor can fail on unusual connection strings — return as-is
    return url;
  }
}

const databaseUrl = resolveDbUrl() ? addServerlessParams(resolveDbUrl()!) : undefined;

// Ensure DATABASE_URL is always set to the resolved direct connection URL
// so Prisma reads the right value regardless of what Vercel injected.
if (databaseUrl && process.env.DATABASE_URL !== databaseUrl) {
  process.env.DATABASE_URL = databaseUrl;
}

console.log('[Prisma Init] Starting initialization...');
console.log('[Prisma Init] DATABASE_URL is', databaseUrl ? 'SET (length: ' + databaseUrl.length + ')' : 'NOT SET');
console.log('[Prisma Init] NODE_ENV:', process.env.NODE_ENV);
console.log('[Prisma Init] VERCEL:', process.env.VERCEL ? 'yes' : 'no');

// Singleton pattern for serverless environments (prevents connection pool exhaustion)
let prisma: PrismaClient | null = null;

if (global.prisma) {
  console.log('[Prisma Init] Using existing global prisma instance');
  prisma = global.prisma;
} else {
  try {
    console.log('[Prisma Init] Creating new PrismaClient...');

    prisma = new PrismaClient({
      log: ['error', 'warn'],
      errorFormat: 'pretty',
      ...(databaseUrl ? { datasourceUrl: databaseUrl } : {}),
    });

    console.log('✅ [Prisma Init] PrismaClient created successfully');

    // In serverless, store in global to reuse across function invocations
    if (typeof global !== 'undefined') {
      global.prisma = prisma;
      console.log('[Prisma Init] Stored prisma in global for reuse');
    }
  } catch (err: unknown) {
    const e = err as Error & { code?: string };
    console.error('❌ [Prisma Init] FAILED TO CREATE PRISMA CLIENT');
    console.error('[Prisma Init] Error message:', e.message);
    console.error('[Prisma Init] Error code:', e.code);
    console.error('[Prisma Init] Error name:', e.name);
    console.error('[Prisma Init] DATABASE_URL:', databaseUrl ? 'SET (first 50 chars: ' + databaseUrl.substring(0, 50) + '...)' : 'NOT SET');
    console.error('[Prisma Init] Full error:', e.toString());
    console.error('[Prisma Init] Stack trace:', e.stack);
    prisma = null;

    // Don't throw in serverless - return null so endpoints can handle gracefully
    // This allows the API to return proper error responses instead of crashing
    console.error('[Prisma Init] WARNING: Prisma client is null - endpoints will need to handle this');
  }
}

// Handle graceful shutdown (only in non-serverless)
if (!process.env.VERCEL && prisma && typeof prisma.$disconnect === 'function') {
  process.on('beforeExit', async () => {
    try {
      await prisma!.$disconnect();
    } catch (err: unknown) {
      const e = err as Error;
      console.error('Error disconnecting Prisma:', e);
    }
  });
}

export default prisma;
