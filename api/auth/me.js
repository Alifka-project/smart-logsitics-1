// Get current user - session validation
const jwt = require('jsonwebtoken');
const prisma = require('../../src/server/db/prisma');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'unauthorized' });

    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const decoded = jwt.verify(token, secret);
    
    if (!prisma) return res.status(503).json({ error: 'db_unavailable' });

    const driver = await prisma.driver.findUnique({
      where: { id: decoded.sub },
      include: { account: true }
    });

    if (!driver) return res.status(404).json({ error: 'user_not_found' });

    res.json({
      user: {
        id: driver.id,
        username: driver.username,
        email: driver.email,
        role: driver.account?.role || 'driver'
      }
    });
  } catch (error) {
    res.status(401).json({ error: 'unauthorized' });
  }
};
