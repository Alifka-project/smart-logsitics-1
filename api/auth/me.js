// Get current authenticated user
const prisma = require('../../src/server/db/prisma');
const { authenticate } = require('../../src/server/auth');

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized', message: 'No token provided' });
    }

    const token = authHeader.substring(7);
    
    // Verify token using authenticate middleware logic
    const verified = authenticate(req, res);
    if (!verified) {
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
    }

    // Get user info from request (authenticate middleware should have set it)
    const userId = req.user?.sub || req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized', message: 'User ID not found in token' });
    }

    // Fetch driver info
    const driver = await prisma.driver.findUnique({
      where: { id: userId },
      include: { account: true }
    });

    if (!driver) {
      return res.status(404).json({ error: 'user_not_found', message: 'User not found' });
    }

    return res.status(200).json({
      user: {
        id: driver.id,
        username: driver.username,
        email: driver.email,
        phone: driver.phone,
        fullName: driver.fullName,
        role: driver.account?.role || 'driver'
      }
    });

  } catch (error) {
    console.error('[Auth/Me] Error:', error);
    return res.status(500).json({
      error: 'server_error',
      message: process.env.NODE_ENV === 'production' ? 'Server error' : error.message
    });
  }
};
