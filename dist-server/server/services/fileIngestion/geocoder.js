"use strict";
/**
 * Server-side geocoder for the auto-ingest path.
 *
 * Used ONLY by /api/ingest/file when an incoming row has no usable
 * coordinates (transformer marked `_usedDefaultCoords: true`). Does not
 * affect manual upload — which continues to use the browser-side
 * src/services/geocodingService.ts with an interactive modal.
 *
 * Uses Google Maps Geocoding API (simple, reliable, generous free tier).
 * Requires env var GOOGLE_GEOCODING_KEY. Falls back to no-op if missing.
 *
 * In-memory cache per-instance reduces duplicate API calls within a batch.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGeocoderConfigured = isGeocoderConfigured;
exports.geocodeOne = geocodeOne;
exports.geocodeMissingCoords = geocodeMissingCoords;
const axios_1 = __importDefault(require("axios"));
const GOOGLE_GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const DUBAI_BOUNDS = '24.7,54.8|25.5,55.7';
const cache = new Map();
function normalizeKey(address) {
    return String(address).trim().replace(/\s+/g, ' ').toLowerCase();
}
function getKey() {
    return (process.env.GOOGLE_GEOCODING_KEY ||
        process.env.GOOGLE_MAPS_API_KEY ||
        process.env.VITE_GOOGLE_GEOCODING_KEY || // legacy fallback
        '').trim();
}
function isGeocoderConfigured() {
    return !!getKey();
}
/**
 * Geocode a single address using Google Maps API.
 * Returns null if address is empty, geocoder is not configured, API fails,
 * or no plausible match is found.
 */
async function geocodeOne(addressRaw) {
    if (!addressRaw)
        return null;
    const key = normalizeKey(addressRaw);
    if (cache.has(key))
        return cache.get(key) ?? null;
    const apiKey = getKey();
    if (!apiKey) {
        cache.set(key, null);
        return null;
    }
    try {
        const { data } = await axios_1.default.get(GOOGLE_GEOCODE_URL, {
            params: {
                address: addressRaw,
                key: apiKey,
                components: 'country:AE',
                bounds: DUBAI_BOUNDS,
            },
            timeout: 10000,
        });
        if (data?.status !== 'OK' || !Array.isArray(data.results) || data.results.length === 0) {
            console.warn(`[Geocoder] No result for "${addressRaw}" — status=${data?.status}`);
            cache.set(key, null);
            return null;
        }
        const r = data.results[0];
        const loc = r?.geometry?.location;
        if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
            cache.set(key, null);
            return null;
        }
        const hit = {
            lat: loc.lat,
            lng: loc.lng,
            accuracy: r?.geometry?.location_type || 'UNKNOWN',
            formattedAddress: r.formatted_address || addressRaw,
        };
        cache.set(key, hit);
        return hit;
    }
    catch (err) {
        const e = err;
        console.warn(`[Geocoder] Request failed for "${addressRaw}": ${e.message}`);
        cache.set(key, null);
        return null;
    }
}
/**
 * Geocode a batch of rows that have _usedDefaultCoords: true.
 * Mutates the rows in-place: sets lat/lng and clears _usedDefaultCoords on
 * successful lookups. Rows that fail geocoding keep their default coords.
 *
 * Returns summary counts for logging.
 */
async function geocodeMissingCoords(rows) {
    if (!isGeocoderConfigured()) {
        const attempted = rows.filter((r) => r._usedDefaultCoords).length;
        if (attempted > 0) {
            console.warn(`[Geocoder] GOOGLE_GEOCODING_KEY not set — ${attempted} rows will keep default coords. Set the env var to enable auto-geocoding.`);
        }
        return { attempted, succeeded: 0, failed: attempted };
    }
    let succeeded = 0;
    let failed = 0;
    let attempted = 0;
    for (const row of rows) {
        if (!row._usedDefaultCoords)
            continue;
        attempted += 1;
        const addr = String(row.address || '').trim();
        if (!addr) {
            failed += 1;
            continue;
        }
        const hit = await geocodeOne(addr);
        if (hit) {
            row.lat = hit.lat;
            row.lng = hit.lng;
            row._usedDefaultCoords = false;
            succeeded += 1;
        }
        else {
            failed += 1;
        }
    }
    console.log(`[Geocoder] Batch complete — attempted=${attempted}, succeeded=${succeeded}, failed=${failed}`);
    return { attempted, succeeded, failed };
}
