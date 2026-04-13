"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const cors_1 = __importDefault(require("cors"));
const syntheticData_js_1 = require("../data/syntheticData.js");
const app = (0, express_1.default)();
const port = process.env.SAP_MOCK_PORT || 5000;
app.use((0, cors_1.default)());
app.use(body_parser_1.default.json());
// Basic in-memory stores
const drivers = [];
const deliveries = [];
const events = {};
// seed drivers and deliveries from synthetic data
(function seed() {
    const synth = (0, syntheticData_js_1.generateSyntheticData)();
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
function requireBasicAuth(req, res, next) {
    const { SAP_USERNAME, SAP_PASSWORD } = process.env;
    if (!SAP_USERNAME) {
        next();
        return;
    }
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Basic ')) {
        res.status(401).json({ error: 'basic_auth_required' });
        return;
    }
    const b = Buffer.from(auth.split(' ')[1] || '', 'base64').toString('utf8');
    const [u, p] = b.split(':');
    if (u === SAP_USERNAME && p === SAP_PASSWORD) {
        next();
        return;
    }
    res.status(401).json({ error: 'invalid_credentials' });
}
app.use(requireBasicAuth);
app.get('/', (req, res) => res.json({ ok: true, service: 'mock-sap' }));
// Drivers
app.get('/Drivers', (req, res) => res.json({ value: drivers }));
app.get('/Drivers/:id', (req, res) => {
    const d = drivers.find(x => x.id === req.params.id);
    if (!d) {
        res.status(404).json({ error: 'not_found' });
        return;
    }
    res.json(d);
});
app.post('/Drivers', (req, res) => {
    const id = String(1000 + drivers.length + 1);
    const item = Object.assign({ id, created_at: new Date().toISOString(), active: true }, req.body);
    drivers.push(item);
    res.status(201).json(item);
});
app.patch('/Drivers/:id', (req, res) => {
    const i = drivers.findIndex(x => x.id === req.params.id);
    if (i === -1) {
        res.status(404).json({ error: 'not_found' });
        return;
    }
    drivers[i] = Object.assign(drivers[i], req.body);
    res.json(drivers[i]);
});
app.post('/Drivers/:id/resetPassword', (req, res) => res.json({ ok: true }));
// Deliveries
app.get('/Deliveries', (req, res) => res.json({ value: deliveries }));
app.get('/Deliveries/:id', (req, res) => {
    const d = deliveries.find(x => x.id === req.params.id);
    if (!d) {
        res.status(404).json({ error: 'not_found' });
        return;
    }
    res.json(d);
});
app.post('/Deliveries/:id/status', (req, res) => {
    const d = deliveries.find(x => x.id === req.params.id);
    if (!d) {
        res.status(404).json({ error: 'not_found' });
        return;
    }
    d.status = req.body.status || d.status;
    const body = req.body;
    const ev = { id: `e-${d.id}-${(events[d.id] || []).length + 1}`, event_type: d.status, payload: { note: body.note || null }, actor_type: body.actor_type || 'system', actor_id: body.actor_id || null, created_at: new Date().toISOString() };
    events[d.id] = events[d.id] || [];
    events[d.id].push(ev);
    res.json({ ok: true, status: d.status });
});
app.post('/Deliveries/:id/assign', (req, res) => {
    const d = deliveries.find(x => x.id === req.params.id);
    if (!d) {
        res.status(404).json({ error: 'not_found' });
        return;
    }
    const body = req.body;
    d.driver_id = body.driver_id;
    const ev = { id: `e-${d.id}-${(events[d.id] || []).length + 1}`, event_type: 'assigned', payload: { driver_id: body.driver_id }, actor_type: 'admin', actor_id: null, created_at: new Date().toISOString() };
    events[d.id] = events[d.id] || [];
    events[d.id].push(ev);
    res.json({ ok: true, assignment: { delivery_id: d.id, driver_id: d.driver_id } });
});
app.get('/Deliveries/:id/events', (req, res) => res.json({ value: events[req.params.id] || [] }));
// Locations and SMSConfirmations (simple)
app.get('/Locations', (req, res) => res.json({ value: drivers.map((d, i) => ({ id: `loc-${i}`, driver_id: d.id, lat: 25 + Math.random() * 0.2, lng: 55 + Math.random() * 0.2, recorded_at: new Date().toISOString() })) }));
app.get('/SMSConfirmations', (req, res) => res.json({ value: [{ id: 'sms-1', phone: '+971400000', created_at: new Date().toISOString() }] }));
app.listen(port, () => console.log(`Mock SAP server running at http://localhost:${port}`));
