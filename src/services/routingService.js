import axios from 'axios';
import { decodePolyline } from '../utils/polylineDecoder';
import { isValidDubaiCoordinates } from './geocodingService';

/**
 * Validate and prepare locations for routing
 */
function validateLocationsForRouting(locations) {
  const errors = [];
  const validLocations = [];

  locations.forEach((loc, idx) => {
    const lat = parseFloat(loc.lat);
    const lng = parseFloat(loc.lng);

    if (isNaN(lat) || isNaN(lng)) {
      errors.push(`Location ${idx + 1} (${loc.address}): Invalid coordinates`);
      return;
    }

    // Warn if outside Dubai but still allow
    if (!isValidDubaiCoordinates(lat, lng)) {
      console.warn(`Location ${idx + 1}: Coordinates outside Dubai area (${lat}, ${lng})`);
    }

    validLocations.push({
      ...loc,
      lat: lat,
      lng: lng
    });
  });

  return { validLocations, errors };
}

export async function calculateRoute(locations) {
  try {
    if (!locations || locations.length < 2) {
      throw new Error('At least 2 locations required for route calculation');
    }

    // Validate locations
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
      addresses: validLocations.map(l => l.address),
      coordinates: validLocations.map(l => `(${l.lat.toFixed(4)}, ${l.lng.toFixed(4)})`)
    });
    
    const response = await axios.post(
      'https://valhalla1.openstreetmap.de/route',
      {
        locations: validLocations.map(loc => ({ 
          lat: loc.lat, 
          lon: loc.lng 
        })),
        costing: 'auto',
        directions_options: { 
          units: 'kilometers',
          language: 'en'
        },
        shape_match: 'map_snap',
        filters: {
          attributes: ['edge.id', 'edge.way_id'],
          action: 'include'
        }
      },
      {
        timeout: 30000
      }
    );

    if (!response.data.trip) {
      throw new Error('Invalid response from routing service - no trip data');
    }

    const trip = response.data.trip;
    
    // Decode all leg shapes
    let allCoordinates = [];
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
      // Fallback: create simple line between locations
      allCoordinates = validLocations.map(loc => [loc.lat, loc.lng]);
    }

    if (allCoordinates.length === 0) {
      console.warn('No coordinates decoded, using location points as fallback');
      allCoordinates = validLocations.map(loc => [loc.lat, loc.lng]);
    }

    console.log('Route calculated successfully:', {
      coordinatesCount: allCoordinates.length,
      distance: trip.summary?.length,
      distanceKm: trip.summary?.length ? (trip.summary.length / 1000).toFixed(2) : 0,
      time: trip.summary?.time,
      timeHours: trip.summary?.time ? (trip.summary.time / 3600).toFixed(2) : 0,
      legsCount: trip.legs?.length,
      geocoded: validLocations.map(l => ({
        address: l.address,
        geocoded: l.geocoded,
        accuracy: l.geocodeAccuracy
      }))
    });

    return {
      coordinates: allCoordinates,
      distance: trip.summary?.length || 0, // meters
      distanceKm: trip.summary?.length ? trip.summary.length / 1000 : 0,
      time: trip.summary?.time || 0, // seconds
      timeHours: trip.summary?.time ? trip.summary.time / 3600 : 0,
      legs: trip.legs || [],
      instructions: trip.legs ? trip.legs.flatMap(leg => leg.maneuvers || []) : [],
      locationsCount: validLocations.length,
      isFallback: false
    };
  } catch (error) {
    console.error('Route calculation failed:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    throw new Error(`Route calculation failed: ${error.message}`);
  }
}

export function calculateETAWithInstallation(routeTime, stopIndex) {
  const INSTALLATION_TIME = 60 * 60; // 1 hour in seconds
  const BUFFER_TIME = 15 * 60; // 15 minutes in seconds
  
  return routeTime + (stopIndex * INSTALLATION_TIME) + (stopIndex * BUFFER_TIME);
}


