import type { Delivery } from '../types';

export type DeliveryListFilter = 'all' | 'pending' | 'confirmed' | 'p1';

const ACTIVE_STATUSES = new Set([
  'pending',
  'out-for-delivery',
  'in-transit',
  'in-progress',
  'scheduled',
  'confirmed',
  'scheduled-confirmed',
  'uploaded',
]);

export function isActiveDeliveryListStatus(status: string): boolean {
  if (!status) return true;
  return ACTIVE_STATUSES.has(status.toLowerCase());
}

export function getActiveDeliveriesForList(deliveries: Delivery[] | undefined | null): Delivery[] {
  const list = deliveries ?? [];
  return list.filter((d) => {
    const status = (d.status || '').toLowerCase();
    return isActiveDeliveryListStatus(status);
  });
}

export function applyDeliveryListFilter(
  deliveries: Delivery[] | undefined | null,
  filter: DeliveryListFilter | undefined,
): Delivery[] {
  const list = deliveries ?? [];
  const safeFilter: DeliveryListFilter = filter ?? 'all';
  const active = getActiveDeliveriesForList(list);
  switch (safeFilter) {
    case 'pending':
      // "Pending" = any delivery that is awaiting admin/driver action — not yet
      // out for delivery and not yet confirmed by the customer for a future date.
      // Includes 'pending' (just uploaded), 'scheduled' (SMS sent, awaiting reply),
      // and 'uploaded' (ingested but not yet actioned).
      return active.filter((d) => {
        const s = (d.status || '').toLowerCase();
        return s === 'pending' || s === 'scheduled' || s === 'uploaded';
      });
    case 'confirmed':
      // "Confirmed" = customer has confirmed their delivery date via the SMS link.
      return active.filter((d) => {
        const s = (d.status || '').toLowerCase();
        return s === 'confirmed' || s === 'scheduled-confirmed';
      });
    case 'p1':
      return active.filter((d) => d.priority === 1);
    default:
      return active;
  }
}

export function countForDeliveryListFilter(
  deliveries: Delivery[] | undefined | null,
  filter: DeliveryListFilter | undefined,
): number {
  return applyDeliveryListFilter(deliveries, filter).length;
}
