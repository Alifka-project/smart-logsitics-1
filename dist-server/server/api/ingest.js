"use strict";
/**
 * Auto-ingestion endpoint.
 *
 * Separate from the manual upload endpoint (`/api/deliveries/upload`) so that
 * the demo-critical manual path is never touched by this feature.
 *
 * Auth: API key header (X-API-Key). The existing `app.use('/api', authenticate)`
 * middleware would block unauthenticated calls — this router is mounted BEFORE
 * that line in `index.ts` so Power Automate / OneDrive callers that have no
 * session cookie can reach it with just the API key.
 *
 * Feature flag: INGEST_ENABLED must be exactly "true" for the endpoint to
 * process files. Default (unset or anything else) returns 503 so the feature
 * is off until explicitly enabled in production.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const processor_1 = require("../services/fileIngestion/processor");
const parser_1 = require("../services/fileIngestion/parser");
const router = (0, express_1.Router)();
function isEnabled() {
    return (process.env.INGEST_ENABLED || '').trim().toLowerCase() === 'true';
}
function constantTimeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}
function verifyApiKey(req) {
    const expected = (process.env.INGEST_API_KEY || '').trim();
    if (!expected)
        return false; // If no key is configured, deny everything.
    const provided = String(req.header('x-api-key') || '').trim();
    if (!provided)
        return false;
    return constantTimeEqual(provided, expected);
}
// GET /api/ingest/health — quick auth + config check. Safe to call publicly.
router.get('/health', (req, res) => {
    const keyOk = verifyApiKey(req);
    res.json({
        ok: true,
        enabled: isEnabled(),
        authenticated: keyOk,
        message: isEnabled()
            ? keyOk
                ? 'ingest_ready'
                : 'key_required_or_invalid'
            : 'ingest_disabled_set_INGEST_ENABLED_true',
    });
});
// POST /api/ingest/file — accepts a base64-encoded file and processes it.
router.post('/file', async (req, res) => {
    if (!isEnabled()) {
        res.status(503).json({ error: 'ingest_disabled', message: 'Set INGEST_ENABLED=true to enable.' });
        return;
    }
    if (!verifyApiKey(req)) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    const body = req.body;
    if (!body || !body.fileBase64) {
        res.status(400).json({ error: 'bad_request', message: 'fileBase64 is required in JSON body.' });
        return;
    }
    let buffer;
    try {
        buffer = (0, parser_1.decodeBase64File)(body.fileBase64);
    }
    catch (err) {
        const e = err;
        res.status(400).json({ error: 'bad_base64', message: e.message });
        return;
    }
    if (buffer.length === 0) {
        res.status(400).json({ error: 'empty_file' });
        return;
    }
    // Size cap — default 10 MB. Large files time out on Vercel regardless.
    const maxBytes = parseInt(process.env.INGEST_MAX_FILE_BYTES || '10485760', 10);
    if (buffer.length > maxBytes) {
        res.status(413).json({ error: 'file_too_large', sizeBytes: buffer.length, limitBytes: maxBytes });
        return;
    }
    try {
        const result = await (0, processor_1.ingestFile)({
            buffer,
            filename: body.filename,
            source: body.source || 'external_ingest',
        });
        const ok = result.errors.length === 0 || result.saved > 0;
        res.status(ok ? 200 : 422).json({ success: ok, ...result });
    }
    catch (err) {
        const e = err;
        console.error('[Ingest] Fatal ingestion error:', e.message, e.stack);
        res.status(500).json({ error: 'ingestion_failed', message: e.message });
    }
});
exports.default = router;
