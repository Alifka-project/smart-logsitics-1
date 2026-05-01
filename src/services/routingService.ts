import axios from 'axios';
import { decodePolyline } from '../utils/polylineDecoder';
import { isValidDubaiCoordinates } from './geocodingService';
import type { Delivery } from '../types';

interface RouteLocation {
  lat: number;
  lng: number;
  address?: string;
  geocoded?: boolean;
  geocodeAccuracy?: string;
}

interface RouteCalculationResult {
  coordinates: [number, number][];
  distance: number;
  distanceKm: number;
  time: number;
  timeHours: number;
  legs: unknown[];
  instructions: unknown[];
  locationsCount: number;
  isFallback: boolean;
}

interface ValidationResult {
  validLocations: RouteLocation[];
  errors: string[];
}

function validateLocationsForRouting(locations: RouteLocation[]): ValidationResult {
  const errors: string[] = [];
  const validLocations: RouteLocation[] = [];

  locations.forEach((loc, idx) => {
    const lat = parseFloat(String(loc.lat));
    const lng = parseFloat(String(loc.lng));

    if (isNaN(lat) || isNaN(lng)) {
      errors.push(`Location ${idx + 1} (${loc.address}): Invalid coordinates`);
      return;
    }

    if (!isValidDubaiCoordinates(lat, lng)) {
      console.warn(`Location ${idx + 1}: Coordinates outside UAE (${lat}, ${lng})`);
    }

    validLocations.push({ ...loc, lat, lng });
  });

  return { validLocations, errors };
}

interface ValhallaTrip {
  summary?: { length?: number; time?: number };
  legs?: Array<{ shape?: string; maneuvers?: unknown[] }>;
}

export async function calculateRoute(locations: RouteLocation[]): Promise<RouteCalculationResult> {
  if (!locations || locations.length < 2) {
    throw new Error('At least 2 locations required for route calculation');
  }

  const { validLocations, errors } = validateLocationsForRouting(locations);

  if (errors.length > 0) {
    console.error('Location validation errors:', errors);
    throw new Error(`Invalid locations: ${errors.join('; ')}`);
  }

  if (validLocations.length < 2) {
    throw new Error('At least 2 valid locations required for route calculation');
  }

  console.log('Calculating route for locations:', {
    count: validLocations.length,
    addresses: validLocations.map((l) => l.address),
    coordinates: validLocations.map((l) => `(${l.lat.toFixed(4)}, ${l.lng.toFixed(4)})`),
  });

  try {
    const response = await axios.post<{ trip: ValhallaTrip }>(
      'https://valhalla1.openstreetmap.de/route',
      {
        locations: validLocations.map((loc) => ({ lat: loc.lat, lon: loc.lng })),
        costing: 'auto',
        directions_options: { units: 'kilometers', language: 'en' },
        shape_match: 'map_snap',
        filters: { attributes: ['edge.id', 'edge.way_id'], action: 'include' },
      },
      { timeout: 30000 },
    );

    if (!response.data.trip) {
      throw new Error('Invalid response from routing service - no trip data');
    }

    const trip = response.data.trip;
    let allCoordinates: [number, number][] = [];

    if (trip.legs && trip.legs.length > 0) {
      trip.legs.forEach((leg, idx) => {
        if (leg.shape) {
          const coords = decodePolyline(leg.shape);
          allCoordinates = allCoordinates.concat(coords);
          console.log(`Route leg ${idx + 1}: ${coords.length} coordinates`);
        }
      });
    } else {
      console.warn('No legs found in route response');
      allCoordinates = validLocations.map((loc) => [loc.lat, loc.lng]);
    }

    if (allCoordinates.length === 0) {
      console.warn('No coordinates decoded, using location points as fallback');
      allCoordinates = validLocations.map((loc) => [loc.lat, loc.lng]);
    }

    return {
      coordinates: allCoordinates,
      distance: trip.summary?.length || 0,
      distanceKm: trip.summary?.length ? trip.summary.length / 1000 : 0,
      time: trip.summary?.time || 0,
      timeHours: trip.summary?.time ? trip.summary.time / 3600 : 0,
      legs: trip.legs || [],
      instructions: trip.legs ? trip.legs.flatMap((leg) => leg.maneuvers || []) : [],
      locationsCount: validLocations.length,
      isFallback: false,
    };
  } catch (error: unknown) {
    const err = error as { message?: string; response?: { data?: unknown; status?: number } };
    console.error('Route calculation failed:', {
      message: err.message,
      response: err.response?.data,
      status: err.response?.status,
    });
    throw new Error(`Route calculation failed: ${err.message}`);
  }
}

export function calculateETAWithInstallation(routeTime: number, stopIndex: number): number {
  const INSTALLATION_TIME = 60 * 60;
  const BUFFER_TIME = 15 * 60;
  return routeTime + stopIndex * INSTALLATION_TIME + stopIndex * BUFFER_TIME;
}
