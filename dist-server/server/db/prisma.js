"use strict";
/**
 * Prisma Client Instance
 * Database is REQUIRED - All queries use Prisma
 *
 * Prisma Client automatically reads DATABASE_URL from environment variables
 * Uses singleton pattern for serverless environments (Vercel)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
// Resolve the best available database URL.
// Priority: DATABASE_URL → POSTGRES_URL → PRISMA_DATABASE_URL (direct, not Accelerate)
// PRISMA_DATABASE_URL may be an Accelerate URL (prisma+postgres://) which is NOT
// usable without @prisma/extension-accelerate, so skip it when it uses that protocol.
function resolveDbUrl() {
    const candidates = [
        process.env.DATABASE_URL,
        process.env.POSTGRES_URL,
        process.env.PRISMA_DATABASE_URL,
    ];
    for (const url of candidates) {
        if (url && !url.startsWith('prisma+postgres://'))
            return url;
    }
    return undefined;
}
const databaseUrl = resolveDbUrl();
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
let prisma = null;
if (global.prisma) {
    console.log('[Prisma Init] Using existing global prisma instance');
    prisma = global.prisma;
}
else {
    try {
        console.log('[Prisma Init] Creating new PrismaClient...');
        prisma = new client_1.PrismaClient({
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
    }
    catch (err) {
        const e = err;
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
            await prisma.$disconnect();
        }
        catch (err) {
            const e = err;
            console.error('Error disconnecting Prisma:', e);
        }
    });
}
exports.default = prisma;
