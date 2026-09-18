/* global __ENV */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const baseUrl = (__ENV.K6_BASE_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const email = __ENV.K6_EMAIL || '';
const password = __ENV.K6_PASSWORD || '';
const productId = __ENV.K6_PRODUCT_ID || '';
const variantId = __ENV.K6_VARIANT_ID || '';

const apiErrors = new Counter('api_errors');
const authLatency = new Trend('auth_latency', true);
const queueProbeLatency = new Trend('queue_probe_latency', true);

export const options = {
  scenarios: {
    staged: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.K6_STAGE_1 || '2m', target: Number(__ENV.K6_VUS_1 || 100) },
        { duration: __ENV.K6_STAGE_2 || '2m', target: Number(__ENV.K6_VUS_2 || 250) },
        { duration: __ENV.K6_STAGE_3 || '2m', target: Number(__ENV.K6_VUS_3 || 500) },
        { duration: __ENV.K6_STAGE_4 || '2m', target: Number(__ENV.K6_VUS_4 || 1000) },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    api_errors: ['count<100'],
  },
};

let accessToken = '';

function record(response, name, tags) {
  const successful = response.status >= 200 && response.status < 400;
  if (!check(response, { [`${name} succeeds`]: () => successful })) apiErrors.add(1, tags);
  return response;
}

function login() {
  const response = http.post(`${baseUrl}/auth/login`, JSON.stringify({ email, password }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { flow: 'login' },
  });
  authLatency.add(response.timings.duration);
  record(response, 'login', { flow: 'login' });
  accessToken = response.json('data.accessToken') || '';
  return response;
}

function authenticatedRequest(method, path, body, tags) {
  if (!accessToken) login();
  const params = {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    tags,
  };
  let response = http.request(method, `${baseUrl}${path}`, body, params);
  if (response.status === 401) {
    const refresh = http.post(`${baseUrl}/auth/refresh`, null, { tags: { flow: 'refresh' } });
    accessToken = refresh.json('data.accessToken') || '';
    if (accessToken) {
      params.headers.Authorization = `Bearer ${accessToken}`;
      response = http.request(method, `${baseUrl}${path}`, body, params);
    }
  }
  return response;
}

export function setup() {
  if (!email || !password || !productId || !variantId) {
    throw new Error('Set K6_EMAIL, K6_PASSWORD, K6_PRODUCT_ID, and K6_VARIANT_ID for disposable staging data');
  }
}

export default function () {
  const browse = http.get(`${baseUrl}/products?limit=20`, { tags: { flow: 'browse' } });
  const search = http.get(`${baseUrl}/products?q=terracotta&limit=20`, { tags: { flow: 'search' } });
  const cart = authenticatedRequest('GET', '/cart', null, { flow: 'cart' });
  const wishlist = authenticatedRequest('GET', '/wishlist', null, { flow: 'wishlist' });
  const preview = authenticatedRequest('POST', '/checkout/preview', JSON.stringify({
    items: [{ productId, variantId, quantity: 1 }],
  }), { flow: 'checkout_preview' });
  const queueProbe = http.get(`${baseUrl}/health/ready`, { tags: { flow: 'readiness' } });
  queueProbeLatency.add(queueProbe.timings.duration);

  record(browse, 'browse', { flow: 'browse' });
  record(search, 'search', { flow: 'search' });
  record(cart, 'cart', { flow: 'cart' });
  record(wishlist, 'wishlist', { flow: 'wishlist' });
  record(preview, 'checkout preview', { flow: 'checkout_preview' });
  record(queueProbe, 'readiness', { flow: 'readiness' });
  sleep(1);
}
