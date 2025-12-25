import fs from 'fs';
import path from 'path';
import axios from 'axios';

const geoFile = path.join(process.cwd(), 'geocode_results.json');

if (!fs.existsSync(geoFile)) {
  console.error('geocode_results.json not found. Run geocoding first.');
  process.exit(2);
}

const geo = JSON.parse(fs.readFileSync(geoFile, 'utf8'));

// Build locations: start with warehouse then all geocoded points
const warehouse = { lat: 25.0053, lng: 55.0760, name: 'Warehouse Jebel Ali' };
const locations = [warehouse];

for (const r of geo) {
  const lat = r.lat;
  const lng = r.lng;
  const addr = r.address || '';
  locations.push({ lat: lat, lng: lng, name: addr });
}

function splitLocationsForRouting(locations, maxWaypoints = 10) {
  if (locations.length <= maxWaypoints) return [locations];
  const chunks = [];
  const warehouse = locations[0];
  const deliveries = locations.slice(1);
  for (let i = 0; i < deliveries.length; i += (maxWaypoints - 2)) {
    const chunk = [warehouse, ...deliveries.slice(i, i + (maxWaypoints - 2))];
    chunks.push(chunk);
  }
  return chunks;
}

// decode Valhalla polyline (precision 6)
function decodePolyline(encoded) {
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const deltaLat = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lat += deltaLat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const deltaLng = ((result & 1) ? ~(result >> 1) : (result >> 1));
    lng += deltaLng;

    coordinates.push([lat / 1e6, lng / 1e6]);
  }
  return coordinates;
}

async function calculateRouteViaValhalla(locations) {
  const chunks = splitLocationsForRouting(locations, 10);
  let allCoordinates = [];
  let totalDistance = 0;
  let totalTime = 0;
  const allLegs = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.log(`Processing chunk ${i + 1}/${chunks.length} (${chunk.length} waypoints)`);
    try {
      // throttle requests to reduce rate-limit errors
      await new Promise(r => setTimeout(r, 1000));
      const resp = await axios.post('https://valhalla1.openstreetmap.de/route', {
        locations: chunk.map(loc => ({ lat: loc.lat, lon: loc.lng })),
        costing: 'auto',
        directions_options: { units: 'kilometers', language: 'en' },
        shape_match: 'map_snap'
      }, { timeout: 30000 });

      const trip = resp.data.trip;
      if (trip && trip.legs) {
        trip.legs.forEach((leg) => {
          if (leg.shape) {
            const coords = decodePolyline(leg.shape);
            allCoordinates = allCoordinates.concat(coords);
          }
          totalDistance += leg.summary?.length || 0;
          totalTime += leg.summary?.time || 0;
        });
        allLegs.push(...trip.legs);
      }
    } catch (e) {
      console.warn('Chunk routing failed:', e.message);
      // fallback: add raw chunk points
      allCoordinates = allCoordinates.concat(chunk.map(l => [l.lat, l.lng]));
    }
  }

  if (allCoordinates.length === 0) allCoordinates = locations.map(l => [l.lat, l.lng]);

  return {
    coordinates: allCoordinates,
    distance: totalDistance,
    distanceKm: totalDistance / 1000,
    time: totalTime,
    timeHours: totalTime / 3600,
    legs: allLegs,
    locationsCount: locations.length,
    chunkCount: chunks.length
  };
}

(async () => {
  try {
    console.log('Calling Valhalla for', locations.length, 'locations');
    const route = await calculateRouteViaValhalla(locations);
    const outFile = path.join(process.cwd(), 'route_result.json');
    fs.writeFileSync(outFile, JSON.stringify(route, null, 2));
    console.log('Route saved to', outFile);
    console.log('Summary:');
    console.log('  locations:', route.locationsCount);
    console.log('  coordinates length:', route.coordinates.length);
    console.log('  distanceKm:', (route.distanceKm || 0).toFixed(2));
    console.log('  chunks:', route.chunkCount);
  } catch (err) {
    console.error('Routing script failed:', err.message);
    process.exit(1);
  }
})();
