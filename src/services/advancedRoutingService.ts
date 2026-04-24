import axios from 'axios';
import { isValidDubaiCoordinates } from './geocodingService';
import { calculateRouteWithOSRM } from './osrmRoutingService';
import api from '../frontend/apiClient';
import type { Delivery } from '../types';

const OPENAI_API_KEY: string =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_OPENAI_API_KEY
    ? (import.meta.env.VITE_OPENAI_API_KEY as string)
    : '';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

interface RouteLocation {
  lat: number;
  lng: number;
  address?: string;
}

interface OptimizationResult {
  sequence: number[];
  explanation: string;
  estimatedDistance: number | null;
  estimatedTime: number | null;
  isFallback?: boolean;
}

interface RouteResult {
  coordinates: [number, number][];
  distance: number;
  distanceKm: number;
  time: number;
  timeHours: number;
  legs: unknown[];
  instructions: unknown[];
  locationsCount: number;
  isFallback: boolean;
  optimization?: OptimizationResult | null;
  optimized?: boolean;
  isMultiLeg?: boolean;
  chunkCount?: number;
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function optimizeRouteWithAI(
  locations: RouteLocation[],
  deliveries: Delivery[],
): Promise<OptimizationResult> {
  try {
    console.log('[OpenAI] Optimizing route sequence for', locations.length, 'locations');

    const locationDescriptions = locations
      .map((loc, idx) => {
        if (idx === 0) return 'Warehouse at Jebel Ali (25.0053, 55.0760)';
        const delivery = deliveries[idx - 1];
        return `Location ${idx}: ${delivery?.address || 'Unknown'} (${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}) - Customer: ${delivery?.customer || 'Unknown'}`;
      })
      .join('\n');

    const prompt = `You are a logistics optimization expert. Given these delivery locations in Dubai, suggest the OPTIMAL delivery sequence to minimize travel time and distance.\n\nLocations:\n${locationDescriptions}\n\nRespond ONLY with a JSON object in this format:\n{\n  "sequence": [0, 3, 1, 2, 4],\n  "explanation": "Brief reason for this sequence",\n  "estimatedDistance": 45.5,\n  "estimatedTime": 120\n}\n\nThe sequence array should contain indices (0 is warehouse/start). Return valid JSON only, no markdown.`;

    const response = await axios.post<{ choices: Array<{ message: { content: string } }> }>(
      OPENAI_API_URL,
      {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a logistics route optimization AI. You respond with valid JSON only.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      },
      {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        timeout: 30000,
      },
    );

    const content = response.data.choices[0].message.content;
    console.log('[OpenAI] Response:', content);

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');

    const optimized = JSON.parse(jsonMatch[0]) as OptimizationResult;
    console.log('[OpenAI] Optimization result:', optimized);
    return optimized;
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('[OpenAI] Optimization failed:', err.message);
    return {
      sequence: Array.from({ length: locations.length }, (_, i) => i),
      explanation: 'Fallback: original sequence',
      estimatedDistance: null,
      estimatedTime: null,
      isFallback: true,
    };
  }
}

function reorderLocations(
  locations: RouteLocation[],
  deliveries: Delivery[],
  sequence: number[],
): { reordered: RouteLocation[]; reorderedDeliveries: Delivery[] } {
  const warehouseLocation = locations[0];
  const deliveryLocations = locations.slice(1);
  const deliveryObjs = deliveries.slice();

  const reordered: RouteLocation[] = [warehouseLocation];
  const reorderedDeliveries: Delivery[] = [];

  for (let i = 1; i < sequence.length; i++) {
    const idx = sequence[i];
    if (idx > 0 && idx - 1 < deliveryLocations.length) {
      reordered.push(deliveryLocations[idx - 1]);
      reorderedDeliveries.push(deliveryObjs[idx - 1]);
    }
  }

  return { reordered, reorderedDeliveries };
}

function validateLocationsForRouting(
  locations: RouteLocation[],
): { validLocations: RouteLocation[]; errors: string[] } {
  const errors: string[] = [];
  const validLocations: RouteLocation[] = [];

  locations.forEach((loc, idx) => {
    const lat = parseFloat(String(loc.lat));
    const lng = parseFloat(String(loc.lng));

    if (isNaN(lat) || isNaN(lng)) {
      errors.push(`Location ${idx + 1}: Invalid coordinates`);
      return;
    }

    if (!isValidDubaiCoordinates(lat, lng)) {
      console.warn(`Location ${idx + 1}: Outside Dubai area (${lat}, ${lng})`);
    }

    validLocations.push({ ...loc, lat, lng });
  });

  return { validLocations, errors };
}

function splitLocationsForRouting(
  locations: RouteLocation[],
  maxWaypoints = 20,
): RouteLocation[][] {
  if (locations.length <= maxWaypoints) return [locations];

  // Overlap consecutive chunks by 1 waypoint so their coordinate arrays
  // connect seamlessly when concatenated — avoids the straight-line jump
  // that occurs if each chunk restarts from the warehouse.
  const chunks: RouteLocation[][] = [];
  let i = 0;
  while (i < locations.length - 1) {
    const end = Math.min(i + maxWaypoints, locations.length);
    chunks.push(locations.slice(i, end));
    if (end >= locations.length) break;
    i = end - 1; // start next chunk from the last point of this one
  }
  return chunks;
}

/** Decode Valhalla polyline6 encoded string into [lat, lng] pairs */
function decodePolyline6(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lat / 1e6, lng / 1e6]);
  }
  return coords;
}

async function calculateRouteChunk(
  locations: RouteLocation[],
): Promise<{ legs: unknown[]; coordinates: [number, number][]; distance: number; duration: number }> {
  // Use OSRM directly — Valhalla is CORS-blocked on production deployments and
  // rate-limits aggressively; OSRM has no CORS restrictions and handles our
  // waypoint counts reliably.
  const coords = locations.map((loc) => `${Number(loc.lng)},${Number(loc.lat)}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;
  console.log(`[Routing] Calling OSRM with ${locations.length} waypoints`);
  const response = await axios.get<{
    code?: string;
    routes?: Array<{ distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs?: unknown[] }>;
  }>(url, { timeout: 30000 });

  if (!response.data || response.data.code !== 'Ok') throw new Error(`OSRM failed: ${response.data?.code}`);
  const route = response.data.routes?.[0];
  if (!route?.geometry?.coordinates) throw new Error('Invalid OSRM response');

  const coordinatesFixed: [number, number][] = route.geometry.coordinates.map((c) => [c[1], c[0]]);
  console.log(`[Routing] OSRM OK — ${coordinatesFixed.length} road-following points`);
  return { legs: route.legs || [], coordinates: coordinatesFixed, distance: route.distance, duration: route.duration };
}

export async function calculateRoute(
  locations: RouteLocation[],
  deliveries: Delivery[] | null = null,
  useAI = true,
): Promise<RouteResult> {
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

  let finalLocations = validLocations;
  let optimization: OptimizationResult | null = null;

  if (useAI && deliveries && validLocations.length > 3) {
    try {
      optimization = await optimizeRouteWithAI(validLocations, deliveries);
      if (!optimization.isFallback && optimization.sequence) {
        const { reordered } = reorderLocations(validLocations, deliveries, optimization.sequence);
        finalLocations = reordered;
        console.log('[Routing] Optimized sequence applied');
      }
    } catch (aiError: unknown) {
      const err = aiError as { message?: string };
      console.warn('[Routing] AI optimization failed, continuing with original order:', err.message);
    }
  }

  console.log('Calculating route for locations:', {
    count: finalLocations.length,
    coordinates: finalLocations.map((l) => `(${l.lat.toFixed(4)}, ${l.lng.toFixed(4)})`),
  });

  const chunks = splitLocationsForRouting(finalLocations, 20);
  console.log(`[Routing] Split ${finalLocations.length} locations into ${chunks.length} chunks`);

  let allCoordinates: [number, number][] = [];
  let totalDistance = 0;
  let totalTime = 0;
  const allLegs: unknown[] = [];

  for (let i = 0; i < chunks.length; i++) {
    try {
      console.log(`[Routing] Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} waypoints)`);
      const routeData = await calculateRouteChunk(chunks[i]);

      if (routeData.coordinates?.length > 0) {
        const validCoords = routeData.coordinates.filter(
          (coord) =>
            Array.isArray(coord) &&
            coord.length === 2 &&
            !isNaN(coord[0]) &&
            !isNaN(coord[1]) &&
            coord[0] >= -90 &&
            coord[0] <= 90 &&
            coord[1] >= -180 &&
            coord[1] <= 180,
        );

        if (validCoords.length > 0) {
          // Skip the first coordinate of subsequent chunks — it is the same
          // waypoint as the last coordinate of the previous chunk (overlap),
          // so appending it would create a duplicate point at the join.
          const toAppend = i === 0 ? validCoords : validCoords.slice(1);
          allCoordinates = allCoordinates.concat(toAppend);
          console.log(`  Chunk ${i + 1}: ${toAppend.length} road-following coordinates (${validCoords.length} raw)`);
        } else {
          console.warn(`  Chunk ${i + 1}: No valid coordinates`);
        }

        totalDistance += routeData.distance || 0;
        totalTime += routeData.duration || 0;

        if (routeData.legs) allLegs.push(...(routeData.legs as unknown[]));
      } else {
        console.warn(`  Chunk ${i + 1}: No coordinates in route data`);
      }
    } catch (chunkError: unknown) {
      const err = chunkError as { message?: string };
      console.error(`[Routing] Chunk ${i + 1} routing failed:`, err.message);
      throw chunkError;
    }
  }

  if (allCoordinates.length === 0) {
    console.error('[Routing] CRITICAL: No road-following coordinates decoded!');
    throw new Error('Failed to decode road-following route - no coordinates available');
  }

  const result: RouteResult = {
    coordinates: allCoordinates,
    distance: totalDistance,
    distanceKm: totalDistance / 1000,
    time: totalTime,
    timeHours: totalTime / 3600,
    legs: allLegs,
    instructions: [],
    locationsCount: finalLocations.length,
    isFallback: false,
    optimization,
    optimized: !!optimization && !optimization.isFallback,
    isMultiLeg: chunks.length > 1,
    chunkCount: chunks.length,
  };

  return result;
}

export function generateFallbackRoute(locations: RouteLocation[]): RouteResult {
  const coordinates: [number, number][] = locations.map((loc) => [
    parseFloat(String(loc.lat)),
    parseFloat(String(loc.lng)),
  ]);

  let totalDistance = 0;
  for (let i = 1; i < locations.length; i++) {
    totalDistance += haversineDistance(
      locations[i - 1].lat,
      locations[i - 1].lng,
      locations[i].lat,
      locations[i].lng,
    );
  }

  return {
    coordinates,
    distance: totalDistance * 1000,
    distanceKm: totalDistance,
    time: 0,
    timeHours: 0,
    legs: [],
    instructions: [],
    locationsCount: locations.length,
    isFallback: true,
    optimization: null,
    optimized: false,
  };
}

export function calculateETAWithInstallation(routeTime: number, stopIndex: number): number {
  const INSTALLATION_TIME = 60 * 60;
  const BUFFER_TIME = 15 * 60;
  return routeTime + stopIndex * INSTALLATION_TIME + stopIndex * BUFFER_TIME;
}

// ── Per-driver route computation ──────────────────────────────────────────────

export const DRIVER_ROUTE_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#f59e0b', // amber
  '#10b981', // emerald
  '#8b5cf6', // violet
  '#f97316', // orange
  '#ec4899', // pink
  '#14b8a6', // teal
  '#6366f1', // indigo
  '#84cc16', // lime
];

export interface DriverRoute {
  driverId: string;
  name: string;
  color: string;
  coordinates: [number, number][];
}

/**
 * For each online driver that has a GPS fix, compute an OSRM road-following
 * route from their current position → their assigned out-for-delivery stops.
 * Falls back to straight-line segments when OSRM is unavailable.
 */
export async function computePerDriverRoutes(
  drivers: Array<{
    id: string;
    fullName?: string | null;
    full_name?: string | null;
    username?: string;
    tracking?: { online?: boolean; location?: { lat: number; lng: number } | null };
  }>,
  deliveries: Array<{
    id: string;
    assignedDriverId?: string | null;
    lat?: number | null;
    lng?: number | null;
    status?: string;
    [key: string]: unknown;
  }>,
): Promise<DriverRoute[]> {
  const onlineWithGPS = drivers.filter((d) => {
    const loc = d.tracking?.location;
    return loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng);
  });

  if (onlineWithGPS.length === 0) return [];

  const results = await Promise.allSettled(
    onlineWithGPS.map(async (driver, idx) => {
      const loc = driver.tracking!.location!;
      const name = driver.fullName || driver.full_name || driver.username || 'Driver';
      const color = DRIVER_ROUTE_COLORS[idx % DRIVER_ROUTE_COLORS.length];

      // Collect this driver's active stops with valid, real coordinates.
      // Includes out-for-delivery AND in-transit AND order-delay — all three
      // mean the driver is actively en route (order-delay is just out-for-
      // delivery past its promised date, still a valid route segment to draw
      // so dispatch staff see where the delayed stop actually is).
      // Skips stops that use the default fallback coords (_usedDefaultCoords=true)
      // since those all cluster at one Dubai point and corrupt the route geometry.
      const ACTIVE_ROUTE_STATUSES = new Set([
        'out-for-delivery',
        'in-transit',
        'in-progress',
        'order-delay',
        'order_delay',
      ]);
      const stops = deliveries
        .filter((d) => {
          const dExt = d as { tracking?: { driverId?: string }; assignedDriverId?: string | null; _usedDefaultCoords?: boolean };
          const isAssigned =
            dExt.tracking?.driverId === driver.id || d.assignedDriverId === driver.id;
          const isActive = ACTIVE_ROUTE_STATUSES.has((d.status || '').toLowerCase());
          const hasRealCoords = !dExt._usedDefaultCoords;
          return isAssigned && isActive && hasRealCoords;
        })
        .map((d) => {
          const lat = Number(d.lat);
          const lng = Number(d.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return { lat, lng };
        })
        .filter((s): s is { lat: number; lng: number } => s !== null);

      const locations = [{ lat: loc.lat, lng: loc.lng }, ...stops];

      if (locations.length < 2) {
        // Driver online but no active stops with real coords — return empty so no broken polyline is rendered
        return { driverId: driver.id, name, color, coordinates: [] };
      }

      try {
        const result = await calculateRouteWithOSRM(locations);
        return { driverId: driver.id, name, color, coordinates: result.coordinates };
      } catch {
        // Straight-line fallback
        const coords: [number, number][] = locations.map((l) => [l.lat, l.lng]);
        return { driverId: driver.id, name, color, coordinates: coords };
      }
    }),
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<DriverRoute> =>
        r.status === 'fulfilled' && r.value.coordinates.length > 0,
    )
    .map((r) => r.value);
}
