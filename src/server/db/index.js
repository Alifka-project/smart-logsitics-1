/**
 * Database Connection - Using Prisma ORM
 * Database is REQUIRED - All queries use Prisma Client
 */

const prisma = require('./prisma');

// Legacy compatibility wrapper for existing SQL queries
// For new code, use prisma directly (e.g., prisma.driver.findUnique())
module.exports = {
  query: async (text, params) => {
    // Legacy SQL: return { rows } for compatibility with code that expects pg client shape
    try {
      let result;
      if (params && params.length > 0) {
        result = await prisma.$queryRawUnsafe(text, ...params);
      } else {
        result = await prisma.$queryRawUnsafe(text);
      }
      const rows = Array.isArray(result) ? result : (result && result.rows ? result.rows : []);
      return { rows };
    } catch (err) {
      console.error('Database query error:', err);
      throw err;
    }
  },
  pool: null, // Not used with Prisma
  prisma, // Export Prisma client for new code
};
