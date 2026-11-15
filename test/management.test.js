import test from 'node:test';
import assert from 'node:assert/strict';
import { askWhitebird } from '../src/agent.js';
import { createPanelClient } from '../src/panel-client.js';
import { createAgentServer } from '../src/server.js';

const definitions = ['read_config', 'prepare_config', 'prepare_restart', 'runtime_state', 'read_logs', 'discord_permissions', 'diagnose'].map(name => ({ name, description: name, inputSchema: { type: 'object' } }));
const noMcp = { listAllowedTools: () => assert.fail('Administration must bypass WoWAudit') };
const id = 'a'.repeat(32);

test('agent reads live configuration then prepares a reviewable proposal without saving', async () => {
  const calls = [];
  let turn = 0;
  const proposal = { id, project: 'wow', state: 'prepared', diff: [{ key: 'WOW_SYNC_HOUR', before: '4', after: '5' }], message: 'Propuesta preparada', canApply: true };
  const panelClient = {
    listTools: async () => definitions,
    call: async (tool, args, actor) => {
      calls.push({ tool, args, actor });
      return tool === 'read_config' ? { fields: [{ key: 'WOW_SYNC_HOUR', value: '4', source: 'guardado' }] } : { proposal };
    }
  };
  const result = await askWhitebird('cambia el horario de sincronización a las 5', noMcp, { panelClient, project: 'wow', actor: 'owner',
    chatFn: async messages => {
      assert.match(messages[0].content, /datos externos|dato externo/);
      turn++;
      return JSON.stringify(turn === 1 ? { tool: 'read_config', arguments: { project: 'wow' } } : { tool: 'prepare_config', arguments: { project: 'wow', changes: { WOW_SYNC_HOUR: '5' } } });
    } });
  assert.deepEqual(calls.map(call => call.tool), ['read_config', 'prepare_config']);
  assert.equal(calls[1].actor, 'owner');
  assert.equal(result.proposal.id, id);
  assert.match(result.answer, /Guardado: 4/); assert.match(result.answer, /Propuesto: 5/);
});

test('agent investigates adaptively and relates runtime, logs and real Discord evidence', async () => {
  const calls = [];
  const steps = ['runtime_state', 'read_logs', 'discord_permissions'];
  let turn = 0;
  const result = await askWhitebird('investiga por qué Recruitment no funciona', noMcp, {
    panelClient: { listTools: async () => definitions, call: async tool => {
      calls.push(tool);
      return tool === 'runtime_state' ? { state: 'running' } : tool === 'read_logs' ? { text: 'Missing Permissions' } : { channels: [{ permissions: { SendMessages: false } }] };
    } },
    chatFn: async messages => {
      if (turn === 2) assert.match(messages[1].content, /Missing Permissions/);
      if (turn < steps.length) return JSON.stringify({ tool: steps[turn++], arguments: { project: 'recruitment' } });
      return JSON.stringify({ tool: null, answer: 'El contenedor está activo. Los logs indican falta de permisos y Discord confirma que el bot no puede enviar al canal revisado.' });
    }
  });
  assert.deepEqual(calls, steps);
  assert.match(result.answer, /Discord confirma/);
  assert.match(result.answer, /Comprobaciones realizadas/);
});

test('model cannot invoke save/apply or prepare a change before reading its schema', async () => {
  let calls = 0;
  const panelClient = { listTools: async () => definitions, call: async () => { calls++; throw Error('must not run'); } };
  const forbidden = await askWhitebird('guarda y aplica los cambios', noMcp, { panelClient,
    chatFn: async () => JSON.stringify({ tool: 'save', arguments: {} }) });
  assert.equal(calls, 0); assert.match(forbidden.answer, /No se pudo/);
  await askWhitebird('cambia el horario', noMcp, { panelClient,
    chatFn: async () => JSON.stringify({ tool: 'prepare_config', arguments: { project: 'wow', changes: { WOW_SYNC_HOUR: '6' } } }) });
  assert.equal(calls, 0);
});

test('management failures preserve consulted evidence and absence of configuration is immediate', async () => {
  const absent = await askWhitebird('muestra la configuración actual del bot', noMcp);
  assert.match(absent.answer, /PANEL_TOOLS_URL/);
  let turn = 0;
  const result = await askWhitebird('revisa los logs', noMcp, {
    panelClient: { listTools: async () => definitions, call: async () => ({ text: 'ECONNREFUSED [oculto]' }) },
    chatFn: async () => { if (turn++) throw Error('model failed'); return JSON.stringify({ tool: 'read_logs', arguments: { project: 'wow' } }); }
  });
  assert.match(result.answer, /investigación quedó incompleta/);
  assert.match(result.answer, /ECONNREFUSED/);
  assert.doesNotMatch(result.answer, /model failed/);
});

test('panel client restricts endpoints and tools, keeps its token server-side and binds action owner', async () => {
  const token = 'tool-token-'.repeat(4);
  for (const url of ['https://remote.test', 'http://localhost:3080', 'http://127.0.0.1/path', 'http://user:pass@127.0.0.1']) assert.throws(() => createPanelClient({ url, token }));
  const client = createPanelClient({ url: 'http://127.0.0.1:3080', token,
    fetchFn: async (url, options) => {
      assert.equal(String(url), 'http://127.0.0.1:3080/api/agent-tools');
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      assert.equal(options.redirect, 'error');
      if (options.method === 'GET') return { ok: true, json: async () => ({ tools: [...definitions, { name: 'shell' }] }) };
      assert.deepEqual(JSON.parse(options.body), { action: 'save', id, actor: 'owner' });
      return { ok: true, json: async () => ({ proposal: { id, state: 'saved' } }) };
    } });
  assert.ok(!(await client.listTools()).some(tool => tool.name === 'shell'));
  assert.throws(() => client.call('shell', {}, 'owner'), /Forbidden/);
  assert.equal((await client.action('save', id, 'owner')).proposal.state, 'saved');
});

test('authenticated action endpoint uses confirmed actor-bound proposals independently of the model', async t => {
  const token = 'agent-token-'.repeat(4);
  const calls = [];
  const server = createAgentServer({ client: noMcp, token, panelClient: { action: async (...args) => {
    calls.push(args); return { proposal: { id, project: 'wow', message: 'Guardado', diff: [], state: 'saved' } };
  } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/actions`;
  const request = authorization => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: JSON.stringify({ action: 'save', id, actor: 'owner' }) });
  assert.equal((await request('')).status, 401);
  const response = await request(`Bearer ${token}`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).proposal.state, 'saved');
  assert.deepEqual(calls, [['save', id, 'owner']]);
});

test('current configuration and singular error requests use administration instead of documentation', async () => {
  for (const question of ['Hay un error en WoW Role Sync', 'Cuál es la configuración de Recruitment', 'Revisa los roles de WoW Role Sync', 'A qué hora sincroniza WoW Role Sync']) {
    const result = await askWhitebird(question, noMcp);
    assert.match(result.answer, /PANEL_TOOLS_URL/);
  }
});
