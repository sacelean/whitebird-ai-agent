import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse } from 'dotenv';
import { update } from './config.js';

const run = promisify(execFile);
const required = {
  wow: ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'BLIZZARD_CLIENT_ID', 'BLIZZARD_CLIENT_SECRET', 'WOW_GUILD_REALM_SLUG', 'WOW_GUILD_SLUG'],
  recruitment: ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_GUILD_ID', 'OFFICER_ROLE_IDS', 'APPLY_CATEGORY_ID', 'RAIDER_CATEGORY_ID', 'ENTRY_CHANNEL_ID'],
  roulette: ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'OFFICER_ROLE_IDS'],
  agent: ['AGENT_API_TOKEN'],
  'agent-discord': ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_GUILD_ID', 'DISCORD_CHANNEL_IDS', 'DISCORD_ROLE_IDS', 'AGENT_API_TOKEN']
};
const units = { agent: 'whitebird-ai-agent', 'agent-discord': 'whitebird-ai-discord' };
const signatures = [
  [/TokenInvalid|invalid (?:bot )?token|HTTP\s*401|Unauthorized/i, 'Autenticación rechazada. Revisa la credencial del componente y vuelve a aplicar su configuración.'],
  [/Missing Permissions|Missing Access|HTTP\s*403/i, 'Acceso denegado. Revisa los permisos y la jerarquía de roles del bot en Discord.'],
  [/ECONNREFUSED/i, 'Conexión rechazada. Comprueba que el servicio de destino esté arrancado y que coincidan sus puertos.'],
  [/ENOENT|SQLITE_CANTOPEN/i, 'Archivo o base de datos inaccesible. Revisa rutas, volúmenes y permisos del usuario del servicio.'],
  [/EADDRINUSE/i, 'Puerto ocupado. Comprueba si existe otra instancia del servicio.'],
  [/invalid_grant|expired.*(?:token|oauth)|oauth.*expired/i, 'La sesión OAuth puede haber caducado. Comprueba la autorización de WoWAudit.'],
  [/ETIMEDOUT|TimeoutError/i, 'Se agotó una espera. Comprueba el servicio de destino y la conectividad.']
];

// Never return raw configuration, command output, log lines or exception messages.
export function createDiagnostics({ projects, execute = run, fetchFn = fetch, panelEnv = process.env } = {}) {
  let busy = false;
  return async function diagnose(question, selectedProject) {
    if (busy) return { tool: 'panel_diagnostics', answer: 'Hay un diagnóstico en curso. Espera a que termine para repetirlo.' };
    busy = true;
    try {
      const text = question.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      let ids = projects.filter(p => text.includes(p.id) || text.includes(p.name.toLowerCase())).map(p => p.id);
      if (/\bruleta\b/.test(text)) ids.push('roulette');
      if (/\bsync\b/.test(text)) ids.push('wow');
      if (/\bagente\b|\bmodelo\b|\boauth\b/.test(text)) ids.push('agent');
      if (/\bpanel\b|\btodos\b|\btodo\b/.test(text)) ids = projects.map(p => p.id);
      if (!ids.length) ids = selectedProject ? [selectedProject] : projects.map(p => p.id);
      if (ids.some(id => !projects.some(p => p.id === id))) return { tool: 'panel_diagnostics', answer: 'Selecciona un componente conocido en el panel.' };
      ids = [...new Set(ids)];
      const findings = [];
      const add = (scope, message) => findings.push(`• ${scope} — ${message}`);
      const configs = new Map();
      // Read related files for cross-component checks, even when diagnosing one bot.
      for (const project of projects) {
        try { configs.set(project.id, { project, text: await readFile(project.path, 'utf8') }); }
        catch { if (ids.includes(project.id)) add(project.name, 'Configuración inaccesible. Revisa la ruta PANEL_* correspondiente y los permisos de lectura.'); }
      }
      for (const config of configs.values()) config.env = parse(config.text);
      for (const id of ids) {
        const config = configs.get(id);
        if (!config) continue;
        const { project, env, text: source } = config;
        let invalid = 0;
        for (const key of required[id] || []) {
          if (!env[key]?.trim()) { invalid++; add(project.name, `Falta ${key}. Complétalo en el formulario del componente.`); }
        }
        // Validate fields independently so one error cannot hide the remaining errors.
        for (const field of project.modules.flatMap(module => module.fields)) {
          if (!Object.hasOwn(env, field.key)) continue;
          try { update(source, { [field.key]: env[field.key] }, project.modules); }
          catch { invalid++; add(project.name, `${field.key} no supera la validación del panel. Corrígelo en su formulario.`); }
        }
        if (!invalid) add(project.name, 'Los campos comprobados superan la validación de configuración guardada.');
        if (!units[id]) {
          const fallback = id === 'recruitment' ? 'data/whitebird-recruitment.sqlite' : id === 'roulette' ? 'data/whitebird.sqlite' : 'data/whitebird-wow-roles.sqlite';
          try {
            if (!(await stat(resolve(project.base, env.DATABASE_PATH || fallback))).isFile()) throw Error();
            add(project.name, 'El archivo SQLite configurado para el host existe.');
          } catch { add(project.name, 'SQLite no accesible desde el host. Revisa DATABASE_PATH y los montajes si el bot se ejecuta en Docker.'); }
        }
        if (id === 'agent') {
          const port = String(Number(env.AGENT_PORT || 3090));
          await inspectModel(env.LLAMA_CHAT_URL || 'http://127.0.0.1:8080/v1/chat/completions', fetchFn, add);
          if (panelEnv.PANEL_AGENT_TOKEN && env.AGENT_API_TOKEN) add('Panel → agente', panelEnv.PANEL_AGENT_TOKEN === env.AGENT_API_TOKEN ? 'Los tokens guardados coinciden.' : 'Los tokens guardados difieren. Actualiza PANEL_AGENT_TOKEN o AGENT_API_TOKEN para que coincidan.');
          else add('Panel → agente', 'Falta el token en alguno de los extremos. Configura PANEL_AGENT_TOKEN y AGENT_API_TOKEN.');
          const urls = [['Panel → agente', panelEnv.PANEL_AGENT_URL], ['Discord → agente', configs.get('agent-discord')?.env.DISCORD_AGENT_URL || 'http://127.0.0.1:3090']];
          for (const [scope, value] of urls) {
            try {
              const url = new URL(value);
              if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || (url.port || '80') !== port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error();
              add(scope, 'La URL guardada coincide con el puerto local del agente.');
            } catch { add(scope, 'La URL falta o difiere del origen local del agente. Revisa la URL y AGENT_PORT.'); }
          }
          const discord = configs.get('agent-discord')?.env;
          if (discord?.AGENT_API_TOKEN && env.AGENT_API_TOKEN) add('Discord → agente', discord.AGENT_API_TOKEN === env.AGENT_API_TOKEN ? 'Los tokens guardados coinciden.' : 'Los tokens guardados difieren. Iguala AGENT_API_TOKEN en ambos componentes.');
          if (env.WOWAUDIT_OAUTH_STORE) {
            try { if (!(await stat(resolve(project.base, env.WOWAUDIT_OAUTH_STORE))).isFile()) throw Error(); add(project.name, 'El archivo OAuth existe. Su vigencia requiere una consulta autenticada.'); }
            catch { add(project.name, 'Almacén OAuth inaccesible. Revisa WOWAUDIT_OAUTH_STORE y sus permisos.'); }
          } else add(project.name, 'WOWAUDIT_OAUTH_STORE sin ruta explícita. Comprueba el almacén utilizado por el servicio.');
        }
        if (id === 'recruitment') {
          const wow = configs.get('wow');
          if (wow) {
            if (env.DISCORD_GUILD_ID && wow.env.DISCORD_GUILD_ID && env.DISCORD_GUILD_ID !== wow.env.DISCORD_GUILD_ID) add(project.name, 'El servidor Discord difiere del configurado en WoW Sync. Revisa DISCORD_GUILD_ID en ambos bots.');
            // Compose uses a host directory, direct Node execution uses a database path.
            if (env.WOW_ROLE_SYNC_DATA_DIR) {
              const target = resolve(project.base, env.WOW_ROLE_SYNC_DATA_DIR);
              const expected = dirname(resolve(wow.project.base, wow.env.DATABASE_PATH || 'data/whitebird-wow-roles.sqlite'));
              if (target !== expected) add(project.name, 'La carpeta compartida de Compose difiere del directorio SQLite que ve el panel para WoW Sync. Comprueba el montaje real de Compose.');
            } else if (env.WOW_ROLE_SYNC_DATABASE_PATH && resolve(project.base, env.WOW_ROLE_SYNC_DATABASE_PATH) !== resolve(wow.project.base, wow.env.DATABASE_PATH || 'data/whitebird-wow-roles.sqlite')) {
              add(project.name, 'La ruta SQLite para ejecución directa difiere de la de WoW Sync. Comprueba las rutas efectivas y los montajes de Compose.');
            }
          } else add(project.name, 'No se pudo comparar la integración porque la configuración de WoW Sync es inaccesible.');
        }
        await inspectRuntime(project, execute, add);
      }
      if (ids.includes('agent')) await inspectAgent(panelEnv, fetchFn, add);
      return { tool: 'panel_diagnostics', answer: `Diagnóstico de ${new Date().toISOString()}\n${findings.join('\n')}\n\nSe ha revisado la configuración guardada y la evidencia de ejecución disponible. Los procesos pueden usar otro archivo o variables de entorno. Los logs se clasifican por patrones en las últimas 60 líneas y pueden contener fallos históricos. La aplicación de cambios pendientes y los permisos reales de Discord requieren comprobación adicional.` };
    } finally { busy = false; }
  };
}

async function inspectRuntime(project, execute, add) {
  const options = { cwd: project.base, timeout: 5000, maxBuffer: 128 * 1024,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => ['PATH', 'HOME', 'USER', 'LANG', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'XDG_RUNTIME_DIR'].includes(key))) };
  const unit = units[project.id];
  const service = project.id === 'roulette' ? 'whitebird-wow-wheel' : 'bot';
  try {
    if (unit) {
      const result = await execute('systemctl', ['is-active', unit], options);
      add(project.name, result.stdout.trim() === 'active' ? 'systemd indica servicio activo.' : 'systemd no confirma un servicio activo. Consulta su estado.');
    } else {
      const { stdout } = await execute('docker', ['compose', 'ps', '--all', '--format', 'json', service], options);
      const raw = stdout.trim();
      const rows = raw.startsWith('[') ? JSON.parse(raw) : raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
      add(project.name, rows.length && rows.every(row => row.State === 'running') ? 'Compose indica contenedor en ejecución.' : 'Compose no confirma un contenedor en ejecución. Revisa su estado y arranque.');
    }
  } catch { add(project.name, 'Estado de ejecución no confirmado. Revisa el servicio, las herramientas instaladas y los permisos de consulta.'); }
  try {
    const { stdout, stderr = '' } = unit
      ? await execute('journalctl', ['--unit', unit, '--lines', '60', '--no-pager', '--output', 'cat'], options)
      : await execute('docker', ['compose', 'logs', '--tail', '60', '--no-color', service], options);
    const logs = `${stdout}\n${stderr}`;
    let found = false;
    for (const [pattern, message] of signatures) {
      if (pattern.test(logs)) { found = true; add(project.name, `Indicio en logs recientes. ${message}`); }
    }
    if (!logs.trim()) add(project.name, 'La consulta de logs devolvió un resultado vacío.');
    else if (!found) add(project.name, 'Los logs consultados no contienen los patrones de error reconocidos.');
  } catch { add(project.name, 'Logs no disponibles. Revisa los permisos de consulta y el servicio.'); }
}

async function inspectAgent(env, fetchFn, add) {
  try {
    const url = new URL(env.PANEL_AGENT_URL);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !env.PANEL_AGENT_TOKEN) throw Error();
    const response = await fetchFn(new URL('/health', url), { headers: { Authorization: `Bearer ${env.PANEL_AGENT_TOKEN}` }, signal: AbortSignal.timeout(3000), redirect: 'error' });
    if (response.status === 401) return add('API del agente', 'Autenticación rechazada. Comprueba el token cargado por ambos servicios y reinícialos tras actualizarlo.');
    if (!response.ok) throw Error();
    const health = await response.json();
    if (health.status !== 'ok' || typeof health.busy !== 'boolean') throw Error();
    add('API del agente', health.busy ? 'Responde con autenticación y está ocupada.' : 'Responde con autenticación y está disponible.');
  } catch { add('API del agente', 'No se pudo verificar /health. Revisa PANEL_AGENT_URL, el servicio y su conexión local.'); }
}

async function inspectModel(value, fetchFn, add) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw Error();
    const response = await fetchFn(new URL('/health', url), { signal: AbortSignal.timeout(3000), redirect: 'error' });
    add('Modelo local', response.ok ? 'El endpoint /health responde correctamente. La calidad de las respuestas requiere una consulta real.' : 'El endpoint /health devuelve un error. Revisa llama-server y la carga del modelo.');
  } catch { add('Modelo local', 'No se pudo verificar /health. Revisa LLAMA_CHAT_URL y llama-server.'); }
}
