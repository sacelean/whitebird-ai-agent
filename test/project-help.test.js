import test from 'node:test';
import assert from 'node:assert/strict';
import { askWhitebird } from '../src/agent.js';
import { projectHelp } from '../src/project-help.js';
import { projects } from '../src/project-knowledge.js';

const cases = [
  ['¿Qué hace WOW-ROLE-SYNC?', /calderos.*informes WoWAudit y propuestas BIS/],
  ['¿Cómo funciona Recruitment?', /New Apply/],
  ['¿Cómo se acepta un apply?', /apply-aceptar/],
  ['¿Cómo se rechaza una solicitud?', /motivo es obligatorio/],
  ['¿Cómo corrijo el main en Recruitment?', /apply-corregir/],
  ['¿Qué permisos necesita Recruitment?', /Message Content Intent/],
  ['¿Cómo funciona la ruleta?', /13/],
  ['¿Cómo registro un alter?', /registrar-alter/],
  ['¿Cómo funciona el ranking de alters?', /ilvl equipado/],
  ['¿Cómo reinicio la ronda de la ruleta?', /alter-reset-all confirmar:true/],
  ['¿Cómo cambio el rol del alter?', /alter-spec/],
  ['¿Qué permisos necesita la ruleta?', /Adjuntar archivos/],
  ['¿Cómo funcionan los calderos?', /calderos-asignar/],
  ['¿Cómo propone BIS WoW Role Sync?', /bis-proponer/],
  ['¿Cómo funciona el informe de raiders en WoW Role Sync?', /informe-raiders/],
  ['¿Cómo funcionan los avisos de gemas en WoW Role Sync?', /equipo-comprobar/],
  ['¿Cómo se felicita el ascenso en WoW Role Sync?', /Recluta a Raider/],
  ['¿Cómo se renombran los canales Raider en WoW Role Sync?', /rol-nombre-reino/],
  ['¿Qué horarios tiene WoW Role Sync?', /WOW_SYNC_HOUR/],
  ['¿Cómo se vincula un main en WoW Role Sync?', /vinculacion-asignar/],
  ['¿Cómo funciona el agente de IA?', /mismo servicio/],
  ['¿Qué es MCP en Whitebird IA?', /herramienta MCP/],
  ['¿Cómo se usa whitebird-ask en Discord?', /DISCORD_CHANNEL_IDS/],
  ['¿Cómo se configura el agente?', /AGENT_API_TOKEN/],
  ['¿Cómo funciona el control pane?', /Selecciona el componente/],
  ['¿Cómo se guardan los cambios en el control pane?', /reemplazo atomico|reemplazo atómico/],
  ['¿Qué bots conoces?', /Recruitment/]
];

for (const [question, expected] of cases) {
  test(`documented bot help: ${question}`, async () => {
    const result = await askWhitebird(question, {
      listAllowedTools: () => assert.fail('Documentation must bypass MCP')
    }, { chatFn: () => assert.fail('Documentation must not wait for the model') });
    assert.equal(result.tool, null);
    assert.match(result.answer, expected);
    assert.ok(result.answer.length <= 1900, 'Complete answer must fit Discord');
  });
}

test('selected project supports contextual questions, explicit names take priority', () => {
  assert.match(projectHelp('¿Cómo funciona?', 'recruitment').answer, /New Apply/);
  assert.match(projectHelp('¿Cómo funciona la ruleta?', 'recruitment').answer, /13/);
  assert.match(projectHelp('¿Cómo funciona?', 'agent-discord').answer, /whitebird-ask/);
  assert.match(projectHelp('¿Cómo funciona?').answer, /Indica qué componente/);
  assert.match(projectHelp('¿Cómo colaboran Recruitment y WoW Role Sync?').answer, /comparte las vinculaciones/);
});

test('WoWAudit data questions retain their tool-selection path even with a selected project', () => {
  for (const project of projects) {
    assert.equal(projectHelp('¿Qué eventos tenemos próximamente?', project.id), null);
    assert.equal(projectHelp('¿Qué loot hemos recibido?', project.id), null);
  }
});
