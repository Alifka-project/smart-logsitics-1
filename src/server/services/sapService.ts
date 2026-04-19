/**
 * SAP Service - thin wrapper for SAP API calls.
 * Falls back gracefully if SAP is not configured.
 */

interface SapResponse {
  data?: unknown;
  status?: number;
}

export async function call(endpoint: string, method = 'get', data: unknown = null, params: Record<string, unknown> = {}): Promise<SapResponse> {
  try {
    const sapBaseUrl = process.env.SAP_BASE_URL;
    if (!sapBaseUrl) {
      return { data: { value: [] } };
    }
     
    const axios = require('axios') as { get: Function; post: Function };
    const url = `${sapBaseUrl}${endpoint}`;
    const auth = { username: process.env.SAP_USERNAME || '', password: process.env.SAP_PASSWORD || '' };
    const res = method === 'get'
      ? await axios.get(url, { params, auth })
      : await axios.post(url, data, { auth });
    return { data: res.data, status: res.status };
  } catch {
    return { data: { value: [] } };
  }
}

export async function ping(): Promise<SapResponse> {
  return call('', 'get');
}

export default { ping, call };
