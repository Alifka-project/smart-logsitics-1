// Direct serverless function for login
const prisma = require('../../src/server/db/prisma');
const { hashPassword, comparePassword, generateAccessToken, generateRefreshToken } = require('../../src/server/auth');

module.exports = async (req, res) => {
  console.log('[Login API] Request received:', req.method, req.url);
  
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
    // Parse body if needed (Vercel automatically parses JSON)
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        console.error('[Login API] Failed to parse body:', e);
        return res.status(400).json({ error: 'invalid_json' });
      }
    }
    
    console.log('[Login API] Body parsed, checking credentials...');
    const { username, password } = body;
    
    if (!username || !password) {
      console.log('[Login API] Missing username or password');
      return res.status(400).json({ error: 'username_password_required' });
    }

    console.log('[Login API] Checking database for user:', username);
    
    // Verify Prisma is initialized
    if (!prisma) {
      console.error('[Login API] Prisma client not initialized');
      return res.status(503).json({ 
        error: 'service_unavailable',
        message: 'Database not available'
      });
    }

    // Find user
    const driver = await prisma.driver.findUnique({
      where: { username: username.trim() },
      include: { account: true }
    });
    
    console.log('[Login API] User lookup complete:', driver ? 'Found' : 'Not found');

    if (!driver || !driver.account) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    // Check password (schema uses passwordHash, not hashed_password)
    console.log('[Login API] Verifying password...');
    const isValid = await comparePassword(password, driver.account.passwordHash);
    
    console.log('[Login API] Password verification:', isValid ? 'Valid' : 'Invalid');
    
    if (!isValid) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    // Generate tokens
    console.log('[Login API] Generating tokens...');
    const payload = {
      sub: driver.id,
      username: driver.username,
      role: driver.account.role || 'driver'
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);
    
    console.log('[Login API] Login successful for user:', username);

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
    console.error('[Login API] Error:', error.message);
    console.error('[Login API] Error code:', error.code);
    console.error('[Login API] Stack:', error.stack);
    console.error('[Login API] Environment:', {
      DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'NOT SET',
      NODE_ENV: process.env.NODE_ENV
    });
    
    return res.status(500).json({ 
      error: 'server_error', 
      message: process.env.NODE_ENV === 'production' ? 'Server error. Please try again later.' : error.message,
      details: process.env.NODE_ENV !== 'production' ? {
        code: error.code,
        name: error.name
      } : undefined
    });
  }
};
