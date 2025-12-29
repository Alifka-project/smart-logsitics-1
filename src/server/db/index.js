/**
 * Database Connection - Using Prisma ORM
 * Database is REQUIRED - All queries use Prisma Client
 */

const prisma = require('./prisma');

// Legacy compatibility wrapper for existing SQL queries
// For new code, use prisma directly (e.g., prisma.driver.findUnique())
module.exports = {
  query: async (text, params) => {
    // For legacy SQL queries, use prisma.$queryRawUnsafe
    // NOTE: Prisma uses $1, $2 placeholders, but pg uses $1, $2, $3...
    // We need to handle both formats
    try {
      if (params && params.length > 0) {
        // Replace $1, $2, $3... with $1, $2, $3... (Prisma uses same format)
        return await prisma.$queryRawUnsafe(text, ...params);
      } else {
        return await prisma.$queryRawUnsafe(text);
      }
    } catch (err) {
      console.error('Database query error:', err);
      throw err;
    }
  },
  pool: null, // Not used with Prisma
  prisma, // Export Prisma client for new code
};
