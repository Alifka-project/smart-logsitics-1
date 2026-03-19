/**
 * Database Connection - Using Prisma ORM
 * Database is REQUIRED - All queries use Prisma Client
 */

import prisma from './prisma';

interface QueryResult {
  rows: unknown[];
  rowCount?: number;
}

// Legacy compatibility wrapper for existing SQL queries
// For new code, use prisma directly (e.g., prisma.driver.findUnique())
export const query = async (text: string, params?: unknown[]): Promise<QueryResult> => {
  // Legacy SQL: return { rows } for compatibility with code that expects pg client shape
  try {
    if (!prisma) throw new Error('Prisma client not initialized');
    let result: unknown;
    if (params && params.length > 0) {
      result = await prisma.$queryRawUnsafe(text, ...params);
    } else {
      result = await prisma.$queryRawUnsafe(text);
    }
    const resultObj = result as { rows?: unknown[] } | null;
    const rows = Array.isArray(result) ? result : (resultObj && resultObj.rows ? resultObj.rows : []);
    return { rows };
  } catch (err: unknown) {
    console.error('Database query error:', err);
    throw err;
  }
};

export const pool = null; // Not used with Prisma
export { prisma }; // Export Prisma client for new code
