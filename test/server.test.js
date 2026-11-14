import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentServer } from '../src/server.js';
import { createAgentApi } from '../integrations/control-pane/agent-api.js';

const token = 'test-token-'.repeat(4);
async function fixture(t, ask) {
  const server = createAgentServer({ client: {}, token, port: 3090, ask });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (body = { question: 'Eventos' }, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/ask`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  return { server, request };
}
test('API authenticates backend requests and blocks browsers and hostile Host', async t => {
  const { request } = await fixture(t, async () => ({ tool: null, answer: 'Respuesta' }));
  assert.equal((await request({}, { Authorization: '' })).status, 401);
  assert.equal((await request({}, { Origin: 'http://evil.test' })).status, 403);
  assert.equal((await request()).status, 200);
});
test('API validates bounded input and sanitizes failures', async t => {
  const { request } = await fixture(t, async () => { throw Error('secret-token'); });
  for (const body of [{}, null, { question: 4 }, { question: ' ' }, { question: 'x'.repeat(1001) }, '{']) assert.equal((await request(body)).status, 400);
  assert.equal((await request('x'.repeat(9000))).status, 413);
  assert.equal((await request({}, { 'Content-Type': 'text/plain' })).status, 415);
  const response = await request(); assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /secret-token/);
});
test('only one question can use the shared MCP client at a time, including after failure', async t => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const work = new Promise(resolve => { release = resolve; });
  const { request } = await fixture(t, async () => { started(); await work; throw Error('failed'); });
  const first = request(); await entered;
  try { assert.equal((await request()).status, 429); }
  finally { release(); }
  assert.equal((await first).status, 502);
  assert.equal((await request()).status, 502);
});
test('panel proxy preserves contract, checks CSRF, and keeps token server-side', async t => {
  const { server } = await fixture(t, async q => ({ tool: 'list_events', answer: `Respuesta: ${q}` }));
  const api = createAgentApi({ url: `http://127.0.0.1:${server.address().port}`, token });
  async function invoke(method, body, headers = {}) {
    const req = Object.assign((async function* () { yield Buffer.from(JSON.stringify(body)); })(), { method, headers: { 'content-type': 'application/json', ...headers } });
    let result;
    await api(req, {}, { csrf: 'csrf-test', send: (_res, status, data) => { result = { status, data }; } });
    return result;
  }
  assert.deepEqual((await invoke('GET')).data, { enabled: true, csrf: 'csrf-test' });
  assert.equal((await invoke('POST', { question: 'Eventos' })).status, 403);
  const result = await invoke('POST', { question: ' Eventos ' }, { 'x-panel-csrf': 'csrf-test' });
  assert.deepEqual(result, { status: 200, data: { tool: 'list_events', answer: 'Respuesta: Eventos' } });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(token));
});
test('panel proxy rejects remote URLs and hides upstream errors', async () => {
  for (const url of ['https://remote.test', 'http://localhost:3090', 'http://127.0.0.1:3090/path', 'http://user:pass@127.0.0.1']) assert.throws(() => createAgentApi({ url, token }));
  const api = createAgentApi({ url: 'http://127.0.0.1:3090', token, fetchFn: async () => { throw Error('secret'); } });
  const req = Object.assign((async function* () { yield Buffer.from('{"question":"Eventos"}'); })(), { method: 'POST', headers: { 'content-type': 'application/json', 'x-panel-csrf': 'csrf' } });
  let result;
  await api(req, {}, { csrf: 'csrf', send: (_res, status, data) => { result = { status, data }; } });
  assert.equal(result.status, 502); assert.doesNotMatch(JSON.stringify(result), /secret/);
});
