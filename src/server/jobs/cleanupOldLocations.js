// Cleanup job for old location data
// This prevents the live_locations table from growing infinitely
const db = require('../db');

async function cleanupOldLocations() {
  try {
    // Delete locations older than 7 days
    const result = await db.query(
      `DELETE FROM live_locations 
       WHERE recorded_at < NOW() - INTERVAL '7 days'`
    );
    
    const deletedCount = result.rowCount || 0;
    
    if (deletedCount > 0) {
      console.log(`[Cleanup] Deleted ${deletedCount} old location records`);
    }
    
    return { success: true, deletedCount };
  } catch (error) {
    console.error('[Cleanup] Error cleaning up old locations:', error);
    return { success: false, error: error.message };
  }
}

// Run cleanup every hour if this file is executed directly
if (require.main === module) {
  console.log('[Cleanup] Starting location cleanup scheduler...');
  
  // Run immediately on start
  cleanupOldLocations();
  
  // Then run every hour
  setInterval(cleanupOldLocations, 60 * 60 * 1000);
}

module.exports = { cleanupOldLocations };
