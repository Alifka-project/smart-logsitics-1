// Reset admin password to admin123
const prisma = require('../src/server/db/prisma');
const { hashPassword } = require('../src/server/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    console.log('[Reset Password] Starting...');

    // Hash the new password
    const newPassword = 'admin123';
    const passwordHash = await hashPassword(newPassword);
    console.log('[Reset Password] Password hashed');

    // Find admin user
    const admin = await prisma.driver.findUnique({
      where: { username: 'Admin' },
      include: { account: true }
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        error: 'Admin user not found'
      });
    }

    if (!admin.account) {
      return res.status(404).json({
        success: false,
        error: 'Admin account not found'
      });
    }

    // Update password
    await prisma.account.update({
      where: { id: admin.account.id },
      data: { passwordHash }
    });

    console.log('[Reset Password] Password updated successfully');

    return res.status(200).json({
      success: true,
      message: 'Admin password reset to admin123',
      loginInfo: {
        username: 'Admin',
        password: 'admin123'
      }
    });

  } catch (error) {
    console.error('[Reset Password] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
