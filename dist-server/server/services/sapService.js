"use strict";
/**
 * SAP Service - thin wrapper for SAP API calls.
 * Falls back gracefully if SAP is not configured.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.call = call;
exports.ping = ping;
async function call(endpoint, method = 'get', data = null, params = {}) {
    try {
        const sapBaseUrl = process.env.SAP_BASE_URL;
        if (!sapBaseUrl) {
            return { data: { value: [] } };
        }
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const axios = require('axios');
        const url = `${sapBaseUrl}${endpoint}`;
        const auth = { username: process.env.SAP_USERNAME || '', password: process.env.SAP_PASSWORD || '' };
        const res = method === 'get'
            ? await axios.get(url, { params, auth })
            : await axios.post(url, data, { auth });
        return { data: res.data, status: res.status };
    }
    catch {
        return { data: { value: [] } };
    }
}
async function ping() {
    return call('', 'get');
}
exports.default = { ping, call };
