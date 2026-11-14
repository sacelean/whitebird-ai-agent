import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const installer = resolve('deploy/install-release.sh');
const mock = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const file = process.env.MOCK_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
state.calls.push([command, ...args]);
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const fail = name => {
  if (process.env['FAIL_' + name] && !state.failed[name]) {
    state.failed[name] = true; save(); process.exit(1);
  }
};
if (command === 'sudo') {
  if (args.includes('-l')) fail('PERMISSION');
  else {
    const action = args[2], unit = args[3];
    if (action === 'stop') { fail('STOP'); state.active = state.active.filter(x => x !== unit); }
    if (action === 'start') { fail('START'); state.active.push(unit); }
  }
} else if (command === 'systemctl') {
  const active = args[0] === 'is-active' ? state.active : state.enabled;
  save(); process.exit(active.includes(args.at(-1)) ? 0 : 1);
} else if (command === 'node') {
  if (args.some(x => x.endsWith('check-runtime.mjs'))) {
    if (state.active.includes('whitebird-ai-agent.service')) throw Error('Concurrent OAuth use');
    fail('RUNTIME');
  }
  if (args.some(x => x.endsWith('check-service.mjs'))) fail('HEALTH');
  if (args.includes('--register')) fail('REGISTER');
} else if (command === 'npm') {
  fail('NPM');
} else if (command === 'timeout') {
  if (state.active.includes('whitebird-ai-agent.service')) throw Error('Concurrent OAuth use');
  fail('RUNTIME');
} else if (command === 'tar') {
  const dest = args[args.indexOf('-C') + 1];
  for (const name of ['whitebird-ai-agent', 'whitebird-wowaudit-mcp']) fs.mkdirSync(path.join(dest, name), { recursive: true });
} else if (command === 'mv') {
  fail('MOVE');
  fs.renameSync(args[1], args[2]);
} else if (command === 'readlink') {
  try { console.log(fs.realpathSync(args.at(-1))); } catch { save(); process.exit(1); }
} else if (command === 'flock') {
  fail('LOCK');
}
save();
`;

function fixture(t, env = {}, managed = true) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'whitebird-deploy-')));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const base = join(home, 'whitebird');
  const bin = join(home, 'mock-bin');
  mkdirSync(bin);
  for (const name of ['node', 'npm', 'sudo', 'systemctl', 'tar', 'timeout', 'mv', 'readlink', 'flock']) {
    writeFileSync(join(bin, name), mock, { mode: 0o755 });
  }
  for (const dir of ['shared', 'incoming/123-1', 'releases/old']) mkdirSync(join(base, dir), { recursive: true });
  writeFileSync(join(base, 'shared/agent.env'), '');
  writeFileSync(join(base, 'shared/discord.env'), '');
  writeFileSync(join(base, 'incoming/123-1/agent-release.tar.gz'), 'mock archive');
  symlinkSync(join(base, 'releases/old'), join(base, 'current'));
  const units = managed ? ['whitebird-ai-agent.service', 'whitebird-ai-discord.service'] : [];
  const stateFile = join(home, 'state.json');
  writeFileSync(stateFile, JSON.stringify({ active: units, enabled: units, calls: [], failed: {} }));
  const result = spawnSync('bash', [installer, '123-1'], {
    env: { ...process.env, HOME: home, PATH: bin + ':' + process.env.PATH, MOCK_STATE: stateFile, ...env },
    encoding: 'utf8', timeout: 10000
  });
  return { result, state: JSON.parse(readFileSync(stateFile, 'utf8')), current: realpathSync(join(base, 'current')), base };
}

const lifecycle = state => state.calls.filter(c => c[0] === 'sudo' && !c.includes('-l')).map(c => c.slice(3).join(' '));

test('deploy stops OAuth consumers, registers command, activates and restarts in order', t => {
  const { result, state, current, base } = fixture(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(current, join(base, 'releases/123-1'));
  assert.deepEqual(lifecycle(state), [
    'stop whitebird-ai-discord.service', 'stop whitebird-ai-agent.service',
    'start whitebird-ai-agent.service', 'start whitebird-ai-discord.service'
  ]);
  const register = state.calls.findIndex(c => c.includes('--register'));
  const runtime = state.calls.findIndex(c => c.some(x => x.endsWith('check-runtime.mjs')));
  const health = state.calls.findIndex(c => c.some(x => x.endsWith('check-service.mjs')));
  assert.ok(register > runtime && health > register);
});

for (const fault of ['RUNTIME', 'REGISTER', 'HEALTH', 'START', 'MOVE', 'STOP']) {
  test(`deployment failure ${fault} preserves/restores old release and services`, t => {
    const { result, state, current, base } = fixture(t, { ['FAIL_' + fault]: '1' });
    assert.notEqual(result.status, 0);
    assert.equal(current, join(base, 'releases/old'));
    assert.deepEqual([...new Set(state.active)].sort(), ['whitebird-ai-agent.service', 'whitebird-ai-discord.service']);
    assert.match(result.stderr, /restoring the previous release/);
  });
}

for (const fault of ['NPM', 'PERMISSION', 'LOCK']) {
  test(`preflight/preparation failure ${fault} never interrupts running services`, t => {
    const { result, state, current, base } = fixture(t, { ['FAIL_' + fault]: '1' });
    assert.notEqual(result.status, 0);
    assert.equal(current, join(base, 'releases/old'));
    assert.deepEqual(lifecycle(state), []);
  });
}

test('CLI-only installation leaves unconfigured services stopped', t => {
  const { result, state, current, base } = fixture(t, {}, false);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(current, join(base, 'releases/123-1'));
  assert.deepEqual(lifecycle(state), []);
  assert.equal(state.calls.some(c => c.includes('--register')), false);
});
