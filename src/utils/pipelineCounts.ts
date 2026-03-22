import type { Delivery } from '../types';

export type PipelineStage =
  | 'uploaded'
  | 'sms_sent'
  | 'confirmed'
  | 'assigned'
  | 'delivered';

export interface PipelineCounts {
  uploaded: number;
  sms_sent: number;
  confirmed: number;
  assigned: number;
  delivered: number;
}

/** Each delivery is counted in exactly one pipeline bucket (current stage). */
export function computePipelineCounts(deliveries: Delivery[] | undefined | null): PipelineCounts {
  const counts: PipelineCounts = {
    uploaded: 0,
    sms_sent: 0,
    confirmed: 0,
    assigned: 0,
    delivered: 0,
  };

  const list = deliveries ?? [];
  for (const d of list) {
    const s = (d.status || '').toLowerCase();
    const assignedDriver =
      Boolean(d.assignedDriverId) ||
      Boolean((d as Record<string, unknown>)['driverName']);

    if (
      [
        'delivered',
        'delivered-with-installation',
        'delivered-without-installation',
        'finished',
        'completed',
        'pod-completed',
      ].includes(s)
    ) {
      counts.delivered += 1;
      continue;
    }

    if (
      assignedDriver ||
      ['out-for-delivery', 'in-transit', 'in-progress'].includes(s)
    ) {
      counts.assigned += 1;
      continue;
    }

    if (['confirmed', 'scheduled-confirmed'].includes(s)) {
      counts.confirmed += 1;
      continue;
    }

    if (s === 'scheduled') {
      counts.sms_sent += 1;
      continue;
    }

    counts.uploaded += 1;
  }

  return counts;
}

/** Confirmed orders that are not yet driver-assigned (ready to assign). */
export function countReadyToAssign(deliveries: Delivery[] | undefined | null): number {
  return (deliveries ?? []).filter((d) => {
    const s = (d.status || '').toLowerCase();
    const ok = ['confirmed', 'scheduled-confirmed'].includes(s);
    const hasDriver =
      Boolean(d.assignedDriverId) ||
      Boolean((d as Record<string, unknown>)['driverName']);
    return ok && !hasDriver;
  }).length;
}

export function countFailed(deliveries: Delivery[] | undefined | null): number {
  return (deliveries ?? []).filter((d) => {
    const s = (d.status || '').toLowerCase();
    return (
      s === 'cancelled' ||
      s === 'rejected' ||
      s === 'failed' ||
      s.includes('fail')
    );
  }).length;
}

export function countReturned(deliveries: Delivery[] | undefined | null): number {
  return (deliveries ?? []).filter((d) => (d.status || '').toLowerCase() === 'returned')
    .length;
}
