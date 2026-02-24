import { isUnrecognizableAddress } from './addressHandler';

export function assignPriorities(deliveries) {
  // Separate deliveries with unrecognizable/missing addresses to the end
  const resolvable = deliveries.filter(
    d => !isUnrecognizableAddress(d.address) && d.geocodeAccuracy !== 'FAILED'
  );
  const unresolvable = deliveries.filter(
    d => isUnrecognizableAddress(d.address) || d.geocodeAccuracy === 'FAILED'
  );

  // Sort resolvable by distance from warehouse
  const sorted = [...resolvable].sort((a, b) =>
    a.distanceFromWarehouse - b.distanceFromWarehouse
  );

  // Assign priorities in thirds
  const third = Math.ceil(sorted.length / 3);

  const prioritized = sorted.map((delivery, index) => {
    if (index < third) {
      return { ...delivery, priority: 1, priorityLabel: 'High - Closest' };
    } else if (index < third * 2) {
      return { ...delivery, priority: 2, priorityLabel: 'Medium - Mid Distance' };
    } else {
      return { ...delivery, priority: 3, priorityLabel: 'Low - Furthest' };
    }
  });

  // Append unresolvable addresses at the end with a special priority flag
  const unresolvablePrioritized = unresolvable.map(d => ({
    ...d,
    priority: 99,
    priorityLabel: 'Address Unresolvable — listed last',
    addressUnresolvable: true
  }));

  return [...prioritized, ...unresolvablePrioritized];
}
