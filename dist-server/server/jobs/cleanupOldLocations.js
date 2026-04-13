"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupOldLocations = cleanupOldLocations;
// Cleanup job for old location data
// This prevents the live_locations table from growing infinitely
const db = __importStar(require("../db"));
async function cleanupOldLocations() {
    try {
        // Delete locations older than 7 days
        const result = await db.query(`DELETE FROM live_locations 
       WHERE recorded_at < NOW() - INTERVAL '7 days'`);
        const deletedCount = result.rowCount || 0;
        if (deletedCount > 0) {
            console.log(`[Cleanup] Deleted ${deletedCount} old location records`);
        }
        return { success: true, deletedCount };
    }
    catch (error) {
        const e = error;
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
