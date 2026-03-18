import { isUnrecognizableAddress } from './addressHandler';
import type { Delivery, PrioritizedDelivery } from '../types';

export function assignPriorities(deliveries: Delivery[]): PrioritizedDelivery[] {
  const resolvable = deliveries.filter(
    (d) => !isUnrecognizableAddress(d.address) && d.geocodeAccuracy !== 'FAILED',
  );
  const unresolvable = deliveries.filter(
    (d) => isUnrecognizableAddress(d.address) || d.geocodeAccuracy === 'FAILED',
  );

  const sorted = [...resolvable].sort(
    (a, b) => (a.distanceFromWarehouse ?? 0) - (b.distanceFromWarehouse ?? 0),
  );

  const third = Math.ceil(sorted.length / 3);

  const prioritized: PrioritizedDelivery[] = sorted.map((delivery, index) => {
    if (index < third) {
      return {
        ...delivery,
        priority: 1,
        priorityLabel: 'High - Closest',
        distanceFromWarehouse: delivery.distanceFromWarehouse ?? 0,
      };
    } else if (index < third * 2) {
      return {
        ...delivery,
        priority: 2,
        priorityLabel: 'Medium - Mid Distance',
        distanceFromWarehouse: delivery.distanceFromWarehouse ?? 0,
      };
    } else {
      return {
        ...delivery,
        priority: 3,
        priorityLabel: 'Low - Furthest',
        distanceFromWarehouse: delivery.distanceFromWarehouse ?? 0,
      };
    }
  });

  const unresolvablePrioritized: PrioritizedDelivery[] = unresolvable.map((d) => ({
    ...d,
    priority: 99,
    priorityLabel: 'Address Unresolvable — listed last',
    addressUnresolvable: true,
    distanceFromWarehouse: d.distanceFromWarehouse ?? 0,
  }));

  return [...prioritized, ...unresolvablePrioritized];
}
