/**
 * Utility to clear cached deliveries and reload from database
 */

export function clearDeliveriesCache() {
  console.log('[Cache] Clearing deliveries from localStorage...');
  localStorage.removeItem('deliveries_data');
  console.log('[Cache] ✓ Cache cleared!');
}

export function hasFakeDeliveryIds() {
  try {
    const stored = localStorage.getItem('deliveries_data');
    if (!stored) return false;
    
    const deliveries = JSON.parse(stored);
    const hasFake = deliveries.some(d => {
      const id = d.id || '';
      return id.match(/^delivery-\d+$/);
    });
    
    return hasFake;
  } catch (error) {
    return false;
  }
}

export function getStoredDeliveryCount() {
  try {
    const stored = localStorage.getItem('deliveries_data');
    if (!stored) return 0;
    const deliveries = JSON.parse(stored);
    return deliveries.length;
  } catch (error) {
    return 0;
  }
}

export function showCacheWarning() {
  if (hasFakeDeliveryIds()) {
    console.warn('━'.repeat(60));
    console.warn('⚠️  WARNING: Old cached deliveries detected!');
    console.warn('   Your browser has OLD deliveries with fake IDs:');
    console.warn('   - delivery-1, delivery-2, etc.');
    console.warn('   These IDs DO NOT exist in the database!');
    console.warn('');
    console.warn('   Solution:');
    console.warn('   1. Click "Reload from Database" button');
    console.warn('   2. OR Clear cache manually (Ctrl+Shift+Delete)');
    console.warn('   3. Then SMS will work!');
    console.warn('━'.repeat(60));
    return true;
  }
  return false;
}
