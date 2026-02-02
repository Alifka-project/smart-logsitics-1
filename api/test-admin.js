// Test if admin user exists
const prisma = require('../src/server/db/prisma');

module.exports = async (req, res) => {
  console.log('[Test Admin] Checking for admin user...');

  try {
    if (!prisma) {
      return res.status(503).json({
        success: false,
        error: 'Prisma client not initialized'
      });
    }

    // Check for admin user
    const admin = await prisma.driver.findUnique({
      where: { username: 'admin' },
      include: { account: true }
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin user not found',
        error: 'No driver with username "admin" exists in database'
      });
    }

    console.log('[Test Admin] Admin user found:', {
      id: admin.id,
      username: admin.username,
      hasAccount: !!admin.account,
      accountRole: admin.account?.role,
      hasPassword: !!admin.account?.passwordHash
    });

    return res.status(200).json({
      success: true,
      message: 'Admin user exists',
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        phone: admin.phone,
        fullName: admin.fullName,
        account: {
          role: admin.account?.role,
          hasPasswordHash: !!admin.account?.passwordHash
        }
      }
    });

  } catch (error) {
    console.error('[Test Admin] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code
    });
  }
};
