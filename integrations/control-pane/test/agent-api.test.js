import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentApi } from '../agent-api.js';
const token = 'unit-test-token-'.repeat(3);
async function request(api, body = { question: 'Eventos' }, csrf = 'csrf', method = 'POST') {
  const req = Object.assign((async function* () { yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)); })(), { method, headers: { 'content-type': 'application/json', 'x-panel-csrf': csrf } });
  let result;
  await api(req, {}, { csrf: 'csrf', send: (_res, status, data) => { result = { status, data }; } });
  return result;
}
test('agent proxy disabled without configuration', async () => {
  const api = createAgentApi({ url: '', token: '' });
  assert.deepEqual((await request(api, {}, '', 'GET')).data, { enabled: false, csrf: 'csrf' });
  assert.equal((await request(api)).status, 503);
});
test('agent proxy checks CSRF and validates input', async () => {
  const api = createAgentApi({ url: 'http://127.0.0.1:3090', token, fetchFn: () => { throw Error('Must not fetch'); } });
  assert.equal((await request(api, {}, '')).status, 403);
  for (const body of [null, {}, { question: 3 }, { question: ' ' }, { question: 'x'.repeat(1001) }, '{']) assert.equal((await request(api, body)).status, 400);
  assert.equal((await request(api, 'x'.repeat(9000))).status, 413);
});
test('agent proxy forwards trimmed question with server-side authentication', async () => {
  const api = createAgentApi({ url: 'http://127.0.0.1:3090', token, fetchFn: async (url, options) => {
    assert.equal(String(url), 'http://127.0.0.1:3090/ask');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { question: 'Eventos' });
    return { ok: true, json: async () => ({ tool: 'list_events', answer: 'Respuesta', secret: 'do not expose' }) };
  } });
  assert.deepEqual(await request(api, { question: ' Eventos ', team: 'ignored' }), { status: 200, data: { tool: 'list_events', answer: 'Respuesta' } });
});
test('agent proxy rejects remote endpoints and sanitizes upstream failures', async () => {
  for (const url of ['https://remote.test', 'http://127.0.0.1/path', 'http://user:pass@127.0.0.1', 'http://127.0.0.1?token=x']) assert.throws(() => createAgentApi({ url, token }));
  for (const response of [{ status: 429 }, { ok: false, status: 401 }, { ok: true, json: async () => ({ secret: token }) }]) {
    const api = createAgentApi({ url: 'http://127.0.0.1:3090', token, fetchFn: async () => response });
    const result = await request(api);
    assert.equal(result.status, response.status === 429 ? 429 : 502);
    assert.ok(!JSON.stringify(result).includes(token));
  }
});
