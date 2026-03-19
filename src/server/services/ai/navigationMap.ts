/**
 * Navigation map for "where is X" / "how to open Y" queries.
 * Used by searchExecutor.findNavigationTarget and by ai.js for navSuggestions.
 */

export interface NavigationEntry {
  label: string;
  path: string;
  keywords: string[];
  roles: string[];
}

export interface NavigationResult {
  label: string;
  path: string;
}

const NAVIGATION_MAP: NavigationEntry[] = [
  { label: 'Dashboard', path: '/admin', keywords: ['dashboard', 'home', 'overview', 'summary', 'kpi', 'main page', 'start'], roles: ['admin'] },
  { label: 'Deliveries', path: '/deliveries', keywords: ['deliveries', 'delivery list', 'orders', 'upload', 'shipment', 'manage deliveries', 'delivery management', 'all deliveries', 'check delivery status', 'see status', 'view status', 'order status'], roles: ['admin', 'driver', 'delivery_team'] },
  { label: 'Driver Monitoring', path: '/admin/operations?tab=monitoring', keywords: ['monitoring', 'tracking', 'live map', 'gps', 'driver location', 'truck', 'vehicle', 'real-time', 'live tracking', 'where is driver', 'driver tracking', 'track driver', 'truck monitoring', 'fleet'], roles: ['admin'] },
  { label: 'Delivery Control', path: '/admin/operations?tab=control', keywords: ['control', 'assign', 'assignment', 'dispatch', 'manage driver', 'delivery control', 'allocate', 'route'], roles: ['admin'] },
  { label: 'Delivery Tracking', path: '/admin/operations?tab=delivery-tracking', keywords: ['delivery tracking', 'track delivery', 'track order', 'delivery map', 'delivery location', 'where is my order', 'order tracking', 'map', 'maps', 'live map', 'driver map', 'tracking map', 'see map', 'view map'], roles: ['admin'] },
  { label: 'Communication', path: '/admin/operations?tab=communication', keywords: ['communication', 'chat', 'message', 'messaging', 'talk', 'contact driver', 'inbox', 'send message'], roles: ['admin', 'delivery_team'] },
  { label: 'Alerts', path: '/admin/operations?tab=alerts', keywords: ['alerts', 'alert', 'notifications', 'overdue', 'warning', 'issue', 'problem', 'unconfirmed', 'sms alert'], roles: ['admin'] },
  { label: 'Reports', path: '/admin/reports', keywords: ['reports', 'report', 'performance', 'analytics', 'statistics', 'charts', 'insights', 'data'], roles: ['admin'] },
  { label: 'POD Report', path: '/admin/reports/pod', keywords: ['pod', 'proof of delivery', 'evidence', 'signature', 'photo proof', 'delivery proof', 'pod report'], roles: ['admin'] },
  { label: 'Users & Drivers', path: '/admin/users', keywords: ['users', 'user management', 'add driver', 'create driver', 'drivers', 'team', 'staff', 'employee', 'accounts', 'add user', 'manage user'], roles: ['admin'] },
  { label: 'Operations Centre', path: '/admin/operations', keywords: ['operations', 'operations centre', 'operations center', 'ops'], roles: ['admin'] },
];

function findNavigationTarget(query: string, userRole: string): NavigationResult[] {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  return NAVIGATION_MAP
    .filter(n => n.roles.includes(userRole))
    .map(n => {
      let score = 0;
      for (const kw of n.keywords) {
        if (q.includes(kw)) score += kw.split(' ').length * 10;
      }
      if (score === 0) {
        for (const kw of n.keywords) {
          const parts = kw.split(' ');
          for (const p of parts) {
            if (p.length > 3 && q.includes(p)) score += 3;
          }
        }
      }
      return { ...n, score };
    })
    .filter(n => n.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ score: _s, keywords: _k, roles: _r, ...rest }) => rest);
}

export { NAVIGATION_MAP, findNavigationTarget };
