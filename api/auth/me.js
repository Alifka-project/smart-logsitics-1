// Get current authenticated user
const prisma = require('../../src/server/db/prisma');
const jwt = require('jsonwebtoken');

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
      console.log('[Auth/Me] No authorization header');
      return res.status(401).json({ error: 'unauthorized', message: 'No token provided' });
    }

    const token = authHeader.substring(7);
    console.log('[Auth/Me] Token received, verifying...');
    
    // Verify and decode the JWT token
    let decoded;
    try {
      const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
      decoded = jwt.verify(token, secret);
      console.log('[Auth/Me] Token verified, user ID:', decoded.sub);
    } catch (jwtErr) {
      console.error('[Auth/Me] JWT verification failed:', jwtErr.message);
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
    }

    // Get user ID from token
    const userId = decoded.sub;
    if (!userId) {
      console.error('[Auth/Me] No user ID in token');
      return res.status(401).json({ error: 'unauthorized', message: 'Invalid token payload' });
    }

    // Fetch driver info
    console.log('[Auth/Me] Fetching driver info for ID:', userId);
    const driver = await prisma.driver.findUnique({
      where: { id: userId },
      include: { account: true }
    });

    if (!driver) {
      console.error('[Auth/Me] Driver not found');
      return res.status(404).json({ error: 'user_not_found', message: 'User not found' });
    }

    console.log('[Auth/Me] Success - returning user info');
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
    console.error('[Auth/Me] Error:', error.message);
    console.error('[Auth/Me] Stack:', error.stack);
    return res.status(500).json({
      error: 'server_error',
      message: process.env.NODE_ENV === 'production' ? 'Server error' : error.message
    });
  }
};
