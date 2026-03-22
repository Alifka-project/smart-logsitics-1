/**
 * Routing API - Proxies OSRM requests to avoid CORS in browser
 */
import { Router, Request, Response } from 'express';
import axios from 'axios';
import { requireRole } from '../auth.js';

const router = Router();
const OSRM_BASE = 'https://router.project-osrm.org';

/**
 * POST /api/routing/osrm
 * Body: { locations: [{ lat, lng }] }
 * Returns road-following route coordinates from OSRM
 */
router.post('/osrm', requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const locations = req.body?.locations as Array<{ lat?: number; lng?: number }> | undefined;
    if (!Array.isArray(locations) || locations.length < 2) {
      res.status(400).json({ error: 'At least 2 locations required' });
      return;
    }

    const valid = locations.filter((loc) => {
      const lat = Number(loc?.lat);
      const lng = Number(loc?.lng);
      return Number.isFinite(lat) && Number.isFinite(lng);
    });

    if (valid.length < 2) {
      res.status(400).json({ error: 'Invalid coordinates' });
      return;
    }

    const coordinates = valid.map((loc) => `${Number(loc.lng)},${Number(loc.lat)}`).join(';');
    const url = `${OSRM_BASE}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`;

    const response = await axios.get<{
      code?: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
        legs?: unknown[];
      }>;
    }>(url, { timeout: 45000 });

    if (!response.data || response.data.code !== 'Ok') {
      res.status(502).json({
        error: 'OSRM routing failed',
        code: response.data?.code || 'Unknown',
      });
      return;
    }

    const route = response.data.routes?.[0];
    if (!route?.geometry?.coordinates) {
      res.status(502).json({ error: 'Invalid OSRM response' });
      return;
    }

    const coords: [number, number][] = route.geometry.coordinates.map(
      (c) => [c[1], c[0]] as [number, number],
    );

    res.json({
      coordinates: coords,
      distance: route.distance,
      duration: route.duration,
      legs: route.legs || [],
    });
  } catch (err: unknown) {
    const e = err as { response?: { data?: unknown }; message?: string };
    console.error('[Routing] OSRM proxy error:', e.message);
    res.status(502).json({
      error: 'Routing service unavailable',
      message: e.message || 'Unknown error',
    });
  }
});

export default router;
