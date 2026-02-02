// Test database connection
const prisma = require('../src/server/db/prisma');

module.exports = async (req, res) => {
  console.log('[Test DB] Starting database test...');
  console.log('[Test DB] Environment:', {
    DATABASE_URL: process.env.DATABASE_URL ? 'SET (length: ' + process.env.DATABASE_URL.length + ')' : 'NOT SET',
    POSTGRES_URL: process.env.POSTGRES_URL ? 'SET' : 'NOT SET',
    NODE_ENV: process.env.NODE_ENV,
    JWT_SECRET: process.env.JWT_SECRET ? 'SET' : 'NOT SET'
  });

  try {
    if (!prisma) {
      return res.status(503).json({
        success: false,
        error: 'Prisma client not initialized',
        env: {
          DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'NOT SET',
          POSTGRES_URL: process.env.POSTGRES_URL ? 'SET' : 'NOT SET'
        }
      });
    }

    // Try a simple query
    console.log('[Test DB] Executing test query...');
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    console.log('[Test DB] Query successful:', result);

    // Try to count drivers
    const driverCount = await prisma.driver.count();
    console.log('[Test DB] Driver count:', driverCount);

    return res.status(200).json({
      success: true,
      message: 'Database connection successful',
      driverCount,
      testQuery: result
    });

  } catch (error) {
    console.error('[Test DB] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.toString()
    });
  }
};
