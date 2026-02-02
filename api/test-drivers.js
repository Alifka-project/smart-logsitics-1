// List all drivers
const prisma = require('../src/server/db/prisma');

module.exports = async (req, res) => {
  try {
    const drivers = await prisma.driver.findMany({
      include: { account: true },
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        fullName: true,
        account: {
          select: {
            role: true,
            passwordHash: { select: {} } // Don't return the hash, just check if it exists
          }
        }
      }
    });

    return res.status(200).json({
      success: true,
      count: drivers.length,
      drivers: drivers.map(d => ({
        id: d.id,
        username: d.username,
        email: d.email,
        phone: d.phone,
        fullName: d.fullName,
        role: d.account?.role,
        hasPassword: !!d.account?.passwordHash
      }))
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
