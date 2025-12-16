import axios from 'axios';
import { decodePolyline } from '../utils/polylineDecoder';
import { isValidDubaiCoordinates } from './geocodingService';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Calculate Haversine distance between two coordinates (in km)
 */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Use OpenAI to optimize delivery sequence (TSP-like problem)
 */
export async function optimizeRouteWithAI(locations, deliveries) {
  try {
    console.log('[OpenAI] Optimizing route sequence for', locations.length, 'locations');

    // Create location descriptions for AI
    const locationDescriptions = locations.map((loc, idx) => {
      if (idx === 0) return 'Warehouse at Jebel Ali (25.0053, 55.0760)';
      const delivery = deliveries[idx - 1];
      return `Location ${idx}: ${delivery.address || 'Unknown'} (${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}) - Customer: ${delivery.customer || 'Unknown'}`;
    }).join('\n');

    const prompt = `You are a logistics optimization expert. Given these delivery locations in Dubai, suggest the OPTIMAL delivery sequence to minimize travel time and distance.

Locations:
${locationDescriptions}

Respond ONLY with a JSON object in this format:
{
  "sequence": [0, 3, 1, 2, 4],
  "explanation": "Brief reason for this sequence",
  "estimatedDistance": 45.5,
  "estimatedTime": 120
}

The sequence array should contain indices (0 is warehouse/start). Return valid JSON only, no markdown.`;

    const response = await axios.post(
      OPENAI_API_URL,
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a logistics route optimization AI. You respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    const content = response.data.choices[0].message.content;
    console.log('[OpenAI] Response:', content);

    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const optimized = JSON.parse(jsonMatch[0]);
    console.log('[OpenAI] Optimization result:', optimized);

    return optimized;
  } catch (error) {
    console.error('[OpenAI] Optimization failed:', error.message);
    // Return fallback: warehouse then original order
    return {
      sequence: Array.from({ length: locations.length }, (_, i) => i),
      explanation: 'Fallback: original sequence',
      estimatedDistance: null,
      estimatedTime: null,
      isFallback: true
    };
  }
}

/**
 * Reorder locations based on optimization
 */
function reorderLocations(locations, deliveries, sequence) {
  const warehouseLocation = locations[0]; // Always starts at warehouse
  const deliveryLocations = locations.slice(1);
  const deliveryObjs = deliveries.slice();

  // Build reordered array
  const reordered = [warehouseLocation]; // Start with warehouse
  const reorderedDeliveries = [];

  for (let i = 1; i < sequence.length; i++) {
    const idx = sequence[i];
    if (idx > 0 && idx - 1 < deliveryLocations.length) {
      reordered.push(deliveryLocations[idx - 1]);
      reorderedDeliveries.push(deliveryObjs[idx - 1]);
    }
  }

  return { reordered, reorderedDeliveries };
}

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
      errors.push(`Location ${idx + 1}: Invalid coordinates`);
      return;
    }

    if (!isValidDubaiCoordinates(lat, lng)) {
      console.warn(`Location ${idx + 1}: Outside Dubai area (${lat}, ${lng})`);
    }

    validLocations.push({
      ...loc,
      lat: lat,
      lng: lng
    });
  });

  return { validLocations, errors };
}

/**
 * Split large datasets into manageable chunks for Valhalla routing
 * Valhalla typically supports 25-30 waypoints per request
 */
function splitLocationsForRouting(locations, maxWaypoints = 25) {
  if (locations.length <= maxWaypoints) {
    return [locations];
  }

  const chunks = [];
  const warehouse = locations[0];
  const deliveries = locations.slice(1);

  for (let i = 0; i < deliveries.length; i += (maxWaypoints - 2)) {
    const chunk = [warehouse, ...deliveries.slice(i, i + (maxWaypoints - 2))];
    chunks.push(chunk);
  }

  return chunks;
}

/**
 * Calculate route for a single chunk of locations
 */
async function calculateRouteChunk(locations) {
  const response = await axios.post(
    'https://valhalla1.openstreetmap.de/route',
    {
      locations: locations.map(loc => ({ 
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
    throw new Error('Invalid response from routing service');
  }

  return response.data.trip;
}

/**
 * Calculate optimized route using Valhalla API with support for large datasets
 */
export async function calculateRoute(locations, deliveries = null, useAI = true) {
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

    // Optimize sequence with AI if deliveries provided
    let finalLocations = validLocations;
    let optimization = null;
    
    if (useAI && deliveries && validLocations.length > 3) {
      try {
        optimization = await optimizeRouteWithAI(validLocations, deliveries);
        
        if (!optimization.isFallback && optimization.sequence) {
          const { reordered } = reorderLocations(validLocations, deliveries, optimization.sequence);
          finalLocations = reordered;
          console.log('[Routing] Optimized sequence applied');
        }
      } catch (aiError) {
        console.warn('[Routing] AI optimization failed, continuing with original order:', aiError.message);
      }
    }

    console.log('Calculating route for locations:', {
      count: finalLocations.length,
      coordinates: finalLocations.map(l => `(${l.lat.toFixed(4)}, ${l.lng.toFixed(4)})`)
    });

    // Split large datasets into chunks for Valhalla routing
    const chunks = splitLocationsForRouting(finalLocations, 25);
    console.log(`[Routing] Split ${finalLocations.length} locations into ${chunks.length} chunks`);

    let allCoordinates = [];
    let totalDistance = 0;
    let totalTime = 0;
    const allLegs = [];
    const allInstructions = [];

    // Process each chunk
    for (let i = 0; i < chunks.length; i++) {
      try {
        console.log(`[Routing] Processing chunk ${i + 1}/${chunks.length} (${chunks[i].length} waypoints)`);
        const trip = await calculateRouteChunk(chunks[i]);

        if (trip.legs && trip.legs.length > 0) {
          trip.legs.forEach((leg, idx) => {
            if (leg.shape) {
              const coords = decodePolyline(leg.shape);
              allCoordinates = allCoordinates.concat(coords);
              console.log(`  Leg ${idx + 1}: ${coords.length} coordinates`);
            }
            totalDistance += leg.summary?.length || 0;
            totalTime += leg.summary?.time || 0;
          });
          allLegs.push(...trip.legs);
          if (trip.legs[0]?.maneuvers) {
            allInstructions.push(...trip.legs.flatMap(leg => leg.maneuvers || []));
          }
        }
      } catch (chunkError) {
        console.warn(`[Routing] Chunk ${i + 1} failed, continuing with remaining chunks:`, chunkError.message);
        // Still add the location points even if routing fails
        const chunkPoints = chunks[i].map(loc => [loc.lat, loc.lng]);
        allCoordinates = allCoordinates.concat(chunkPoints);
      }
    }

    if (allCoordinates.length === 0) {
      allCoordinates = finalLocations.map(loc => [loc.lat, loc.lng]);
    }

    const result = {
      coordinates: allCoordinates,
      distance: totalDistance,
      distanceKm: totalDistance / 1000,
      time: totalTime,
      timeHours: totalTime / 3600,
      legs: allLegs,
      instructions: allInstructions,
      locationsCount: finalLocations.length,
      isFallback: false,
      optimization: optimization,
      optimized: !!optimization && !optimization.isFallback,
      isMultiLeg: chunks.length > 1,
      chunkCount: chunks.length
    };

    console.log('Route calculated successfully:', {
      distance: result.distanceKm.toFixed(2),
      time: result.timeHours.toFixed(2),
      optimized: result.optimized,
      multiLeg: result.isMultiLeg,
      chunks: result.chunkCount,
      optimization: result.optimization?.explanation
    });

    return result;
  } catch (error) {
    console.error('Route calculation failed:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    throw error;
  }
}

/**
 * Generate simple fallback route without API
 */
export function generateFallbackRoute(locations) {
  const coordinates = locations.map(loc => [parseFloat(loc.lat), parseFloat(loc.lng)]);
  
  let totalDistance = 0;
  for (let i = 1; i < locations.length; i++) {
    totalDistance += haversineDistance(
      locations[i - 1].lat,
      locations[i - 1].lng,
      locations[i].lat,
      locations[i].lng
    );
  }

  return {
    coordinates,
    distance: totalDistance * 1000, // Convert to meters
    distanceKm: totalDistance,
    time: 0,
    timeHours: 0,
    legs: [],
    instructions: [],
    locationsCount: locations.length,
    isFallback: true,
    optimization: null,
    optimized: false
  };
}

/**
 * Calculate ETA with installation time
 */
export function calculateETAWithInstallation(routeTime, stopIndex) {
  const INSTALLATION_TIME = 60 * 60; // 1 hour in seconds
  const BUFFER_TIME = 15 * 60; // 15 minutes in seconds
  
  return routeTime + (stopIndex * INSTALLATION_TIME) + (stopIndex * BUFFER_TIME);
}
