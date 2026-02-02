// Direct serverless function for login
const prisma = require('../../src/server/db/prisma');
const { hashPassword, comparePassword, generateAccessToken, generateRefreshToken } = require('../../src/server/auth');

module.exports = async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'username_password_required' });
    }

    // Find user
    const driver = await prisma.driver.findUnique({
      where: { username: username.trim() },
      include: { account: true }
    });

    if (!driver || !driver.account) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    // Check password (schema uses passwordHash, not hashed_password)
    const isValid = await comparePassword(password, driver.account.passwordHash);
    
    if (!isValid) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    // Generate tokens
    const payload = {
      sub: driver.id,
      username: driver.username,
      role: driver.account.role || 'driver'
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // Return format matching what the frontend expects
    return res.status(200).json({
      accessToken,
      refreshToken,
      driver: {
        id: driver.id,
        username: driver.username,
        role: payload.role,
        full_name: driver.fullName,
        email: driver.email,
        phone: driver.phone
      },
      clientKey: accessToken, // Alias for compatibility
      csrfToken: 'not-implemented' // Add if needed
    });

  } catch (error) {
    console.error('Login error:', error);
    console.error('Error stack:', error.stack);
    return res.status(500).json({ 
      error: 'server_error', 
      message: process.env.NODE_ENV === 'production' ? 'Server error. Please try again later.' : error.message 
    });
  }
};
