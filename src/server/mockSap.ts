import express, { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { generateSyntheticData } from '../data/syntheticData.js';

const app = express();
const port = process.env.SAP_MOCK_PORT || 5000;

app.use(cors());
app.use(bodyParser.json());

interface Driver {
  id: string;
  username: string;
  email: string;
  phone: string;
  full_name: string;
  active: boolean;
  created_at: string;
}

interface Delivery {
  id: string;
  customer: string;
  address: string;
  lat: number;
  lng: number;
  items: string;
  status: string;
  created_at: string;
  driver_id?: string;
}

interface DeliveryEvent {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  actor_type: string;
  actor_id: string | null;
  created_at: string;
}

// Basic in-memory stores
const drivers: Driver[] = [];
const deliveries: Delivery[] = [];
const events: Record<string, DeliveryEvent[]> = {};

// seed drivers and deliveries from synthetic data
(function seed() {
  const synth = generateSyntheticData() as { phone: string; customer: string; address: string; lat: number; lng: number; items: string }[];
  synth.forEach((s, i) => {
    drivers.push({
      id: String(1000 + i),
      username: `driver${i}`,
      email: `driver${i}@example.com`,
      phone: s.phone,
      full_name: s.customer,
      active: true,
      created_at: new Date().toISOString(),
    });

    const dId = String(2000 + i);
    deliveries.push({
      id: dId,
      customer: s.customer,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      items: s.items,
      status: 'pending',
      created_at: new Date().toISOString(),
    });
    events[dId] = [{ id: `e-${dId}-1`, event_type: 'created', payload: { note: 'seeded' }, actor_type: 'system', actor_id: null, created_at: new Date().toISOString() }];
  });
})();

function requireBasicAuth(req: Request, res: Response, next: NextFunction): void {
  const { SAP_USERNAME, SAP_PASSWORD } = process.env;
  if (!SAP_USERNAME) { next(); return; }
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) { res.status(401).json({ error: 'basic_auth_required' }); return; }
  const b = Buffer.from(auth.split(' ')[1] || '', 'base64').toString('utf8');
  const [u, p] = b.split(':');
  if (u === SAP_USERNAME && p === SAP_PASSWORD) { next(); return; }
  res.status(401).json({ error: 'invalid_credentials' });
}

app.use(requireBasicAuth);

app.get('/', (req: Request, res: Response) => res.json({ ok: true, service: 'mock-sap' }));

// Drivers
app.get('/Drivers', (req: Request, res: Response) => res.json({ value: drivers }));
app.get('/Drivers/:id', (req: Request, res: Response) => {
  const d = drivers.find(x => x.id === req.params.id);
  if (!d) { res.status(404).json({ error: 'not_found' }); return; }
  res.json(d);
});
app.post('/Drivers', (req: Request, res: Response) => {
  const id = String(1000 + drivers.length + 1);
  const item: Driver = Object.assign({ id, created_at: new Date().toISOString(), active: true }, req.body);
  drivers.push(item);
  res.status(201).json(item);
});
app.patch('/Drivers/:id', (req: Request, res: Response) => {
  const i = drivers.findIndex(x => x.id === req.params.id);
  if (i === -1) { res.status(404).json({ error: 'not_found' }); return; }
  drivers[i] = Object.assign(drivers[i], req.body);
  res.json(drivers[i]);
});
app.post('/Drivers/:id/resetPassword', (req: Request, res: Response) => res.json({ ok: true }));

// Deliveries
app.get('/Deliveries', (req: Request, res: Response) => res.json({ value: deliveries }));
app.get('/Deliveries/:id', (req: Request, res: Response) => {
  const d = deliveries.find(x => x.id === req.params.id);
  if (!d) { res.status(404).json({ error: 'not_found' }); return; }
  res.json(d);
});
app.post('/Deliveries/:id/status', (req: Request, res: Response) => {
  const d = deliveries.find(x => x.id === req.params.id);
  if (!d) { res.status(404).json({ error: 'not_found' }); return; }
  d.status = (req.body as { status?: string }).status || d.status;
  const body = req.body as { note?: string; actor_type?: string; actor_id?: string };
  const ev: DeliveryEvent = { id: `e-${d.id}-${(events[d.id]||[]).length+1}`, event_type: d.status, payload: { note: body.note || null }, actor_type: body.actor_type || 'system', actor_id: body.actor_id || null, created_at: new Date().toISOString() };
  events[d.id] = events[d.id] || [];
  events[d.id].push(ev);
  res.json({ ok: true, status: d.status });
});
app.post('/Deliveries/:id/assign', (req: Request, res: Response) => {
  const d = deliveries.find(x => x.id === req.params.id);
  if (!d) { res.status(404).json({ error: 'not_found' }); return; }
  const body = req.body as { driver_id?: string };
  d.driver_id = body.driver_id;
  const ev: DeliveryEvent = { id: `e-${d.id}-${(events[d.id]||[]).length+1}`, event_type: 'assigned', payload: { driver_id: body.driver_id }, actor_type: 'admin', actor_id: null, created_at: new Date().toISOString() };
  events[d.id] = events[d.id] || [];
  events[d.id].push(ev);
  res.json({ ok: true, assignment: { delivery_id: d.id, driver_id: d.driver_id } });
});
app.get('/Deliveries/:id/events', (req: Request, res: Response) => res.json({ value: events[req.params.id as string] || [] }));

// Locations and SMSConfirmations (simple)
app.get('/Locations', (req: Request, res: Response) => res.json({ value: drivers.map((d, i) => ({ id: `loc-${i}`, driver_id: d.id, lat: 25 + Math.random() * 0.2, lng: 55 + Math.random() * 0.2, recorded_at: new Date().toISOString() })) }));
app.get('/SMSConfirmations', (req: Request, res: Response) => res.json({ value: [{ id: 'sms-1', phone: '+971400000', created_at: new Date().toISOString() }] }));

app.listen(port, () => console.log(`Mock SAP server running at http://localhost:${port}`));
