import test from 'node:test';
import assert from 'node:assert/strict';
import { formatToolResult, isReadableAnswer } from '../src/result-format.js';
import { askWhitebird } from '../src/agent.js';

test('events and loot render as labelled facts, preserving counts and IDs', () => {
  const events = formatToolResult({ events: [{ id: 123, name: 'Raid', start: '2026-11-18T20:00:00Z', signups: { confirmed: 20 } }] });
  assert.match(events.text, /ID: 123/);
  assert.match(events.text, /Nombre: Raid/);
  assert.match(events.text, /Inicio: 2026-11-18T20:00:00Z/);
  assert.match(events.text, /Confirmados: 20/);
  assert.equal(events.notice, '');
  const loot = formatToolResult({ records: [{ character: 'Raider A', item: 'Espada', note: null }] });
  assert.match(loot.text, /Personaje: Raider A/);
  assert.match(loot.text, /Objeto: Espada/);
  assert.match(loot.text, /Nota: Sin dato/);
});

test('MCP text JSON is decoded before formatting; empty results remain explicit', () => {
  const result = formatToolResult([{ type: 'text', text: JSON.stringify({ events: [] }) }]);
  assert.match(result.text, /Eventos:\n\s*Sin registros/);
  assert.doesNotMatch(result.text, /"events"|type:|text:/);
  assert.match(formatToolResult({}).text, /Sin datos/);
  assert.match(formatToolResult(JSON.stringify({ events: [] })).text, /Sin registros/);
});

test('large/deep results are bounded and explicitly marked partial', () => {
  const result = formatToolResult({ events: Array.from({ length: 20 }, (_, id) => ({ id, description: 'x'.repeat(400) })) });
  assert.ok(result.text.length <= 6000);
  assert.match(result.text, /12 de 20/);
  assert.match(result.notice, /Vista parcial/);
  const deep = formatToolResult({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } });
  assert.match(deep.notice, /Vista parcial/);
});

for (const output of ['{"answer":"Raid"}', 'Aquí tienes: {"events":[]}', '```json\n{}\n```', '', '<think>JSON</think>']) {
  test(`raw or empty model output uses readable fallback: ${output}`, async () => {
    let calls = 0;
    const result = await askWhitebird('Próximas raids', {
      listAllowedTools: () => [{ name: 'list_events' }],
      callReadTool: async () => ({ events: [{ name: 'Raid del miércoles' }] })
    }, { chatFn: async () => ++calls === 1 ? '{"tool":"list_events","arguments":{}}' : output });
    assert.match(result.answer, /Nombre: Raid del miércoles/);
    assert.equal(result.tool, 'list_events');
    assert.equal(calls, 2);
  });
}

test('model gets readable facts and can explain them; model failures fall back', async () => {
  for (const fails of [false, true]) {
    let calls = 0;
    const result = await askWhitebird('Próximas raids', {
      listAllowedTools: () => [{ name: 'list_events' }],
      callReadTool: async () => ({ events: [{ name: 'Raid del miércoles' }] })
    }, { chatFn: async messages => {
      if (++calls === 1) return '{"tool":"list_events","arguments":{}}';
      assert.match(messages[1].content, /Nombre: Raid del miércoles/);
      assert.doesNotMatch(messages[1].content, /"events"/);
      if (fails) throw Error('model timeout');
      return 'Tienes una raid el miércoles.';
    } });
    if (fails) assert.match(result.answer, /Nombre: Raid del miércoles/);
    else assert.equal(result.answer, 'Tienes una raid el miércoles.');
  }
});

test('partial view notice survives model synthesis', async () => {
  let calls = 0;
  const result = await askWhitebird('Próximas raids', {
    listAllowedTools: () => [{ name: 'list_events' }],
    callReadTool: async () => ({ events: Array.from({ length: 15 }, (_, id) => ({ id })) })
  }, { chatFn: async () => ++calls === 1 ? '{"tool":"list_events","arguments":{}}' : 'Estos son los eventos.' });
  assert.match(result.answer, /Vista parcial/);
});

test('existing 12000-character limit still avoids model synthesis', async () => {
  let calls = 0;
  const result = await askWhitebird('Datos del equipo', {
    listAllowedTools: () => [{ name: 'team_audit' }],
    callReadTool: async () => ({ data: 'x'.repeat(12000) })
  }, { chatFn: async () => { calls++; return '{"tool":"team_audit","arguments":{}}'; } });
  assert.match(result.answer, /demasiados datos/);
  assert.equal(calls, 1);
});

test('plain Spanish explanations are accepted', () => {
  assert.equal(isReadableAnswer('Hay dos eventos.\n• Raid el miércoles.'), true);
});
