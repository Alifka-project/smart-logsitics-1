import L from 'leaflet';

/**
 * Shared map-icon factories used by the driver portal and the customer
 * tracking map so the two views show the same iconography and a customer
 * doesn't see two identical blue pins (driver + delivery) on their map.
 *
 * Three variants:
 *   1. Driver     — BLUE circle with truck glyph.
 *   2. Delivery   — TEAL circle with pin glyph (optional stop number).
 *   3. Priority   — RED pulsing circle with alert glyph + P1 chip.
 *
 * All three return L.DivIcon instances so they compose cleanly with both
 * the raw Leaflet API (L.marker(..., { icon })) used inside DriverPortal
 * and react-leaflet's <Marker icon={...}> used in CustomerTrackingPage.
 *
 * Keep visuals and dimensions here — tweaking anywhere else leaves the
 * two maps out of sync again.
 */

const DRIVER_BLUE_DARK = '#2563eb';
const DELIVERY_TEAL_DARK = '#0d9488';
const PRIORITY_RED_DARK = '#dc2626';

function truckSvg(color: string): string {
  return `<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M14 18H3V6h11v12z"></path>
    <path d="M14 10h4l3 3v5h-7"></path>
    <circle cx="7.5" cy="18.5" r="1.5"></circle>
    <circle cx="17.5" cy="18.5" r="1.5"></circle>
  </svg>`;
}

function pinSvg(color: string): string {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="${color}" aria-hidden="true">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/>
  </svg>`;
}

function alertSvg(color: string): string {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>`;
}

/**
 * Driver live-position marker — used by both the driver's own portal and
 * the customer's tracking map so the customer sees the same pin shape the
 * dispatcher/driver see.
 */
export function createDriverMarkerIcon(): L.DivIcon {
  return L.divIcon({
    className: 'map-icon-driver',
    html: `<div style="
      width: 38px;
      height: 38px;
      border-radius: 999px;
      border: 2px solid white;
      background: radial-gradient(circle at center, rgba(37,99,235,0.35) 0%, rgba(37,99,235,0.15) 55%, rgba(37,99,235,0) 85%);
      box-shadow: 0 0 0 6px rgba(37,99,235,0.16), 0 4px 12px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
    ">${truckSvg(DRIVER_BLUE_DARK)}</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

interface DeliveryIconOptions {
  /** 1-based stop number displayed as a small chip on the driver portal. */
  index?: number;
}

/** Regular delivery destination — teal pin. */
export function createDeliveryMarkerIcon(opts: DeliveryIconOptions = {}): L.DivIcon {
  const { index } = opts;
  const badge = typeof index === 'number' && index > 0
    ? `<span style="
        position: absolute; top: -6px; right: -6px;
        min-width: 18px; height: 18px; padding: 0 5px;
        border-radius: 999px; background: #ffffff; color: ${DELIVERY_TEAL_DARK};
        border: 1.5px solid ${DELIVERY_TEAL_DARK};
        font-size: 10px; font-weight: 700; line-height: 15px; text-align: center;
        box-shadow: 0 1px 4px rgba(0,0,0,0.25);
      ">${index}</span>`
    : '';
  return L.divIcon({
    className: 'map-icon-delivery',
    html: `<div style="position: relative; width: 34px; height: 34px;">
      <div style="
        width: 34px; height: 34px; border-radius: 999px;
        border: 2px solid white;
        background: linear-gradient(135deg, #14b8a6 0%, #0d9488 100%);
        box-shadow: 0 3px 10px rgba(13,148,136,0.4);
        display: flex; align-items: center; justify-content: center;
      ">${pinSvg('#ffffff')}</div>
      ${badge}
    </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

/** Priority / P1 delivery destination — red pulsing alert. */
export function createPriorityMarkerIcon(opts: DeliveryIconOptions = {}): L.DivIcon {
  const { index } = opts;
  const chip = `<span style="
    position: absolute; top: -6px; right: -6px;
    min-width: 22px; height: 18px; padding: 0 5px;
    border-radius: 999px; background: ${PRIORITY_RED_DARK}; color: #ffffff;
    border: 1.5px solid #ffffff;
    font-size: 10px; font-weight: 800; line-height: 15px; text-align: center;
    letter-spacing: 0.3px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.35);
  ">${typeof index === 'number' && index > 0 ? `P${index}` : 'P1'}</span>`;
  return L.divIcon({
    className: 'map-icon-priority',
    html: `<div style="position: relative; width: 38px; height: 38px;">
      <div style="
        width: 38px; height: 38px; border-radius: 999px;
        border: 2px solid white;
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        box-shadow: 0 0 0 6px rgba(220,38,38,0.18), 0 4px 12px rgba(0,0,0,0.3);
        display: flex; align-items: center; justify-content: center;
      ">${alertSvg('#ffffff')}</div>
      ${chip}
    </div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

/**
 * Helper: pick the right icon factory for a delivery based on its metadata.
 * Callers pass the raw delivery metadata object; we only peek at
 * metadata.isPriority since that's where the Delivery Team / Admin write
 * the flag today.
 */
export function createDeliveryIconForDelivery(delivery: { metadata?: unknown }, opts: DeliveryIconOptions = {}): L.DivIcon {
  const meta = delivery.metadata as Record<string, unknown> | null | undefined;
  const isPriority = !!(meta && typeof meta === 'object' && meta.isPriority === true);
  return isPriority ? createPriorityMarkerIcon(opts) : createDeliveryMarkerIcon(opts);
}
