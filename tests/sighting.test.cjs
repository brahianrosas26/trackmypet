const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../api/sighting');

function fixture(options = {}) {
  const state = { calls: [], tag: options.tag ?? { id: 'tag-1', activo: true, perdida: true }, allowed: options.allowed ?? true };
  const env = {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-only-not-a-real-key',
    TRACKMYPET_SIGHTINGS_ENABLED: 'true',
    ...options.env,
  };
  const handler = createHandler({ env, fetcher: async (url, init) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    state.calls.push({ u, init, body });
    if (u.pathname.endsWith('/rpc/tmp_sighting_attempt')) {
      return new Response(JSON.stringify({ allowed: state.allowed, retry_after: 900 }), { status: 200 });
    }
    if (u.pathname === '/rest/v1/tags') {
      return new Response(JSON.stringify(state.tag ? [state.tag] : []), { status: 200 });
    }
    if (u.pathname === '/rest/v1/tag_sightings' && init.method === 'POST') {
      return new Response(JSON.stringify([{ id: 'sighting-1' }]), { status: 201 });
    }
    throw new Error('Unexpected request: ' + url);
  }});
  async function request(body, method = 'POST') {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(payload) { this.body = payload; return this; } };
    await handler({ method, headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': '192.0.2.1' }, body }, res);
    return res;
  }
  return { state, request };
}

const location = { code: '256679', latitude: -34.9011, longitude: -56.1645, accuracy: 18 };

test('sightings remain unavailable until the feature flag is enabled', async () => {
  const f = fixture({ env: { TRACKMYPET_SIGHTINGS_ENABLED: 'false' } });
  const result = await f.request(location);
  assert.equal(result.code, 404);
  assert.equal(f.state.calls.length, 0);
});

test('sighting accepts only valid coordinates and writes no raw IP address', async () => {
  const f = fixture();
  const invalid = await f.request({ ...location, latitude: 91 });
  assert.equal(invalid.code, 400);
  assert.equal(f.state.calls.length, 0);

  const saved = await f.request(location);
  assert.equal(saved.code, 201);
  assert.deepEqual(saved.body, { data: { saved: true } });
  const rpc = f.state.calls[0];
  assert.equal(rpc.u.pathname, '/rest/v1/rpc/tmp_sighting_attempt');
  assert.match(rpc.body.p_ip_hash, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(rpc.body.p_ip_hash, '192.0.2.1');
  const insert = f.state.calls.find(call => call.u.pathname === '/rest/v1/tag_sightings');
  assert.equal(insert.body.tag_id, 'tag-1');
  assert.equal(insert.body.latitude, -34.9011);
  assert.equal(insert.body.longitude, -56.1645);
  assert.equal(insert.body.accuracy_meters, 18);
  assert.ok(insert.body.reported_at);
});

test('a sighting is rejected for a normal, inactive, or rate-limited TAG', async () => {
  for (const options of [
    { tag: { id: 'tag-1', activo: true, perdida: false } },
    { tag: { id: 'tag-1', activo: false, perdida: true } },
    { allowed: false },
  ]) {
    const f = fixture(options);
    const result = await f.request(location);
    assert.equal(result.code, options.allowed === false ? 429 : 409);
    assert.ok(!f.state.calls.some(call => call.u.pathname === '/rest/v1/tag_sightings'));
  }
});

