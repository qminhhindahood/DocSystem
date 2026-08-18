import test from 'node:test';
import assert from 'node:assert/strict';

import { createProxyHandler } from '../src/proxy.mjs';

test('proxies method, path, query, body, and forwarding headers to Cloud Run', async () => {
  let received;
  const fetchUpstream = async (request) => {
    received = request;
    return new Response('created', { status: 201 });
  };
  const handler = createProxyHandler({
    upstreamOrigin: 'https://docai-frontend-in4iwfyf6q-as.a.run.app',
    fetchUpstream,
  });
  const request = new Request('https://docai.dpdns.org/api/session/signup?source=custom', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.8',
      'x-forwarded-for': '198.51.100.99',
    },
    body: JSON.stringify({ username: 'pilot' }),
  });

  const response = await handler(request);

  assert.equal(response.status, 201);
  assert.equal(received.url, 'https://docai-frontend-in4iwfyf6q-as.a.run.app/api/session/signup?source=custom');
  assert.equal(received.method, 'POST');
  assert.equal(received.headers.get('x-forwarded-host'), 'docai.dpdns.org');
  assert.equal(received.headers.get('x-forwarded-proto'), 'https');
  assert.equal(received.headers.get('x-forwarded-for'), '203.0.113.8');
  assert.deepEqual(await received.json(), { username: 'pilot' });
});

test('rewrites upstream redirects back to the custom hostname', async () => {
  const handler = createProxyHandler({
    upstreamOrigin: 'https://docai-frontend-in4iwfyf6q-as.a.run.app',
    fetchUpstream: async () => new Response(null, {
      status: 302,
      headers: { location: 'https://docai-frontend-in4iwfyf6q-as.a.run.app/login?next=%2Fdashboard' },
    }),
  });

  const response = await handler(new Request('https://docai.dpdns.org/dashboard'));

  assert.equal(response.headers.get('location'), 'https://docai.dpdns.org/login?next=%2Fdashboard');
});

test('does not rewrite redirects to external origins', async () => {
  const handler = createProxyHandler({
    upstreamOrigin: 'https://docai-frontend-in4iwfyf6q-as.a.run.app',
    fetchUpstream: async () => new Response(null, {
      status: 302,
      headers: { location: 'https://accounts.example.com/login' },
    }),
  });

  const response = await handler(new Request('https://docai.dpdns.org/login'));

  assert.equal(response.headers.get('location'), 'https://accounts.example.com/login');
});
