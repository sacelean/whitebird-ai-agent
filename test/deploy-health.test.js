import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const script = pathToFileURL(resolve('deploy/check-service.mjs')).href;
const token = 'test-only-service-token-'.repeat(2);
function probe(setup, overrides = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', `${setup}; await import(${JSON.stringify(script)});`], {
    env: { ...process.env, AGENT_PORT: '3090', AGENT_API_TOKEN: token, ...overrides }, encoding: 'utf8', timeout: 5000
  });
}

test('service health uses authenticated HTTP only and tolerates a startup failure', () => {
  const result = probe(`
    let calls = 0;
    globalThis.setTimeout = fn => queueMicrotask(fn);
    globalThis.fetch = async (url, options) => {
      if (url !== 'http://127.0.0.1:3090/health') throw Error('Wrong URL');
      if (options.headers.Authorization !== 'Bearer ' + process.env.AGENT_API_TOKEN) throw Error('Missing auth');
      if (++calls === 1) throw Error('Not started');
      return { ok: true, json: async () => ({ status: 'ok', busy: false }) };
    };
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /health check passed/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(token));
});

test('service health rejects unauthorized and unhealthy responses without exposing token', () => {
  const result = probe(`
    globalThis.setTimeout = fn => queueMicrotask(fn);
    globalThis.fetch = async () => ({ ok: false, status: 401 });
  `);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /did not become healthy/);
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(token));
});

test('invalid health configuration fails before network access', () => {
  const result = probe('globalThis.fetch = () => { throw Error("Unexpected network access"); }', { AGENT_API_TOKEN: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid agent service configuration/);
});
