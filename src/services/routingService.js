import axios from 'axios';
import { decodePolyline } from '../utils/polylineDecoder';

export async function calculateRoute(locations) {
  try {
    const response = await axios.post(
      'https://valhalla1.openstreetmap.de/route',
      {
        locations: locations.map(loc => ({ lat: loc.lat, lon: loc.lng })),
        costing: 'auto',
        directions_options: { units: 'kilometers' }
      }
    );

    const trip = response.data.trip;
    
    // Decode all leg shapes
    let allCoordinates = [];
    trip.legs.forEach(leg => {
      const coords = decodePolyline(leg.shape);
      allCoordinates = allCoordinates.concat(coords);
    });

    return {
      coordinates: allCoordinates,
      distance: trip.summary.length, // km
      time: trip.summary.time, // seconds
      legs: trip.legs,
      instructions: trip.legs.flatMap(leg => leg.maneuvers || [])
    };
  } catch (error) {
    console.error('Route calculation failed:', error);
    throw error;
  }
}

export function calculateETAWithInstallation(routeTime, stopIndex) {
  const INSTALLATION_TIME = 60 * 60; // 1 hour in seconds
  const BUFFER_TIME = 15 * 60; // 15 minutes in seconds
  
  return routeTime + (stopIndex * INSTALLATION_TIME) + (stopIndex * BUFFER_TIME);
}

