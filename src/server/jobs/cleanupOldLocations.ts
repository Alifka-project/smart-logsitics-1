// Cleanup job for old location data
// This prevents the live_locations table from growing infinitely
import * as db from '../db';

interface CleanupResult {
  success: boolean;
  deletedCount?: number;
  error?: string;
}

async function cleanupOldLocations(): Promise<CleanupResult> {
  try {
    // Delete locations older than 7 days
    const result = await db.query(
      `DELETE FROM live_locations 
       WHERE recorded_at < NOW() - INTERVAL '7 days'`
    );

    const deletedCount = (result as { rows: unknown[]; rowCount?: number }).rowCount || 0;

    if (deletedCount > 0) {
      console.log(`[Cleanup] Deleted ${deletedCount} old location records`);
    }

    return { success: true, deletedCount };
  } catch (error: unknown) {
    const e = error as Error;
    console.error('[Cleanup] Error cleaning up old locations:', e);
    return { success: false, error: e.message };
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

export { cleanupOldLocations };
