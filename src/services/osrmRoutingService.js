/**
 * OSRM Routing Service - Alternative road-following routing
 * Uses OSRM (Open Source Routing Machine) for road-following routes
 */

import axios from 'axios';

/**
 * Calculate route using OSRM (road-following)
 * This is an alternative when Valhalla fails
 */
export async function calculateRouteWithOSRM(locations) {
  if (!locations || locations.length < 2) {
    throw new Error('At least 2 locations required');
  }

  try {
    // Format coordinates for OSRM API: "lng,lat;lng,lat;..."
    const coordinates = locations.map(loc => `${loc.lng},${loc.lat}`).join(';');
    
    // Use public OSRM demo server (driving profile)
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;
    
    const response = await axios.get(url, {
      timeout: 30000
    });

    if (!response.data || response.data.code !== 'Ok') {
      throw new Error(`OSRM routing failed: ${response.data?.code || 'Unknown error'}`);
    }

    const route = response.data.routes[0];
    if (!route || !route.geometry || !route.geometry.coordinates) {
      throw new Error('Invalid OSRM response - no geometry');
    }

    // Convert GeoJSON coordinates [lng, lat] to [lat, lng] format for Leaflet
    const coordinates_fixed = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);

    return {
      coordinates: coordinates_fixed,
      distance: route.distance, // meters
      distanceKm: route.distance / 1000,
      time: route.duration, // seconds
      timeHours: route.duration / 3600,
      legs: route.legs || [],
      instructions: [],
      locationsCount: locations.length,
      isFallback: false,
      source: 'osrm'
    };
  } catch (error) {
    console.error('[OSRM] Routing error:', error.message);
    throw error;
  }
}

