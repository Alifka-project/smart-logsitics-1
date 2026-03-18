import api from './apiClient';
import type { AxiosResponse } from 'axios';

export async function pingSap(): Promise<AxiosResponse> {
  return api.get('/sap/ping');
}

export async function callSap(
  endpoint: string,
  method = 'post',
  body: Record<string, unknown> = {},
): Promise<AxiosResponse> {
  return api.post('/sap/call', { endpoint, method, ...body });
}

export default { pingSap, callSap };
