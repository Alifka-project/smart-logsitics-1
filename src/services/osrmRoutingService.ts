/**
 * OSRM Routing Service - Alternative road-following routing
 * Uses OSRM (Open Source Routing Machine) for road-following routes
 */

import axios from 'axios';

interface RouteLocation {
  lat: number;
  lng: number;
  address?: string;
}

interface OSRMRouteResult {
  coordinates: [number, number][];
  distance: number;
  distanceKm: number;
  time: number;
  timeHours: number;
  legs: unknown[];
  instructions: unknown[];
  locationsCount: number;
  isFallback: boolean;
  source: string;
}

export async function calculateRouteWithOSRM(locations: RouteLocation[]): Promise<OSRMRouteResult> {
  if (!locations || locations.length < 2) {
    throw new Error('At least 2 locations required');
  }

  try {
    const coordinates = locations.map((loc) => `${loc.lng},${loc.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`;

    const response = await axios.get<{
      code?: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
        legs?: unknown[];
      }>;
    }>(url, { timeout: 30000 });

    if (!response.data || response.data.code !== 'Ok') {
      throw new Error(`OSRM routing failed: ${response.data?.code || 'Unknown error'}`);
    }

    const route = response.data.routes![0];
    if (!route?.geometry?.coordinates) {
      throw new Error('Invalid OSRM response - no geometry');
    }

    const coordinatesFixed: [number, number][] = route.geometry.coordinates.map(
      (coord) => [coord[1], coord[0]],
    );

    return {
      coordinates: coordinatesFixed,
      distance: route.distance,
      distanceKm: route.distance / 1000,
      time: route.duration,
      timeHours: route.duration / 3600,
      legs: route.legs || [],
      instructions: [],
      locationsCount: locations.length,
      isFallback: false,
      source: 'osrm',
    };
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('[OSRM] Routing error:', err.message);
    throw error;
  }
}
