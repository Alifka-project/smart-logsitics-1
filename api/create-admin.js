// Create admin user
const prisma = require('../src/server/db/prisma');
const { hashPassword } = require('../src/server/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    console.log('[Create Admin] Starting admin user creation...');

    // Check if admin already exists
    const existingAdmin = await prisma.driver.findUnique({
      where: { username: 'admin' }
    });

    if (existingAdmin) {
      return res.status(409).json({
        success: false,
        error: 'Admin user already exists'
      });
    }

    // Hash the password
    const password = 'admin123';
    const passwordHash = await hashPassword(password);
    console.log('[Create Admin] Password hashed');

    // Create admin driver with account
    const admin = await prisma.driver.create({
      data: {
        username: 'admin',
        email: 'admin@electrolux.com',
        phone: '+1234567890',
        fullName: 'Administrator',
        active: true,
        account: {
          create: {
            passwordHash: passwordHash,
            role: 'admin'
          }
        }
      },
      include: { account: true }
    });

    console.log('[Create Admin] Admin user created successfully');

    return res.status(201).json({
      success: true,
      message: 'Admin user created successfully',
      admin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        phone: admin.phone,
        fullName: admin.fullName,
        role: admin.account?.role,
        loginInfo: {
          username: 'admin',
          password: 'admin123'
        }
      }
    });

  } catch (error) {
    console.error('[Create Admin] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code
    });
  }
};
