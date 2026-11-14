import 'dotenv/config';
import { createAgentApi } from './agent-api.js';
import { recruitmentRecords } from './recruitment-records.js';
import { readAudit } from './audit.js';
import { dailyReport } from './daily-report.js';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const runCompose = promisify(execFile);
import { readFile, writeFile, rename, unlink, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
import { view, update, revision, modules, recruitmentModules, rouletteModules } from './config.js';

const here = dirname(fileURLToPath(import.meta.url));
const botsRoot = resolve(here, '..');
export function createPanel({ restartEnabled = process.env.PANEL_RESTART_ENABLED === 'true', execute = runCompose, envPath = resolve(process.env.PANEL_ENV_PATH || join(botsRoot, 'whitebird-wow-role-sync/.env')), port = Number(process.env.PANEL_PORT || 3080), recruitmentEnvPath = resolve(process.env.PANEL_RECRUITMENT_ENV_PATH || join(botsRoot, 'whitebird-recruitment-bot/.env')), rouletteEnvPath = resolve(process.env.PANEL_ROULETTE_ENV_PATH || join(botsRoot, 'whitebird-wow-wheel/.env')) } = {}) {
const origin = `http://127.0.0.1:${port}`;
const csrf = randomBytes(32).toString('hex');
const agentApi = createAgentApi();
let saving = false;
const projects = [
  { id: 'wow', name: 'WoW Role Sync', path: envPath, modules, base: dirname(envPath) },
  { id: 'recruitment', name: 'Recruitment', path: recruitmentEnvPath, modules: recruitmentModules, base: dirname(recruitmentEnvPath) },
  { id: 'roulette', name: 'Ruleta', path: rouletteEnvPath, modules: rouletteModules, base: dirname(rouletteEnvPath) }
];
const readEnv = project => readFile(project.path, 'utf8');
async function state(env, project) {
  const path = resolve(project.base, env.DATABASE_PATH || (project.id === 'recruitment' ? './data/whitebird-recruitment.sqlite' : project.id === 'roulette' ? './data/whitebird.sqlite' : './data/whitebird-wow-roles.sqlite'));
  let db;
  try {
    const { default: Database } = await import('better-sqlite3');
    db = new Database(path, { readonly: true, fileMustExist: true });
    const exists = name => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    const rows = (table, suffix = '') => exists(table) ? db.prepare(`SELECT * FROM ${table} WHERE guild_id=? ${suffix}`).all(env.DISCORD_GUILD_ID || '') : [];
    if (project.id === 'roulette') return { available: true, assignments: rows('assignments'), characters: rows('wow_characters'), panels: rows('panels') };
    if (project.id === 'recruitment') return { available: true, panels: rows('panels') };
    return { available: true, links: rows('wow_links'), assignments: rows('wow_cauldron_assignments'), cauldronPanel: rows('wow_cauldron_panels'), raiderDestination: rows('wowaudit_raider_destinations'), history: rows('wow_sync_history', 'ORDER BY id DESC LIMIT 10') };
  } catch { return { available: false, message: 'SQLite no disponible. Comprueba la ruta, permisos y dependencias. No se ha creado ni modificado la base de datos.' }; }
  finally { db?.close(); }
}
const send = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)) return send(res, 403, { error: 'Origen no permitido.' });
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/api/agent') return await agentApi(req, res, { csrf, send });
    if (url.pathname === '/api/projects' && req.method === 'GET') {
      const list = await Promise.all(projects.map(async p => {
        let available = false;
        if (p.path) { try { await access(p.path); available = true; } catch {} }
        return { id: p.id, name: p.name, available, message: p.path ? 'Archivo .env no encontrado o inaccesible. Configura su ruta al arrancar el panel.' : 'Pendiente de localizar el código y definir sus parámetros reales.' };
      }));
      return send(res, 200, list);
    }
    const project = projects.find(p => p.id === (url.searchParams.get('project') || 'wow'));
    if (url.pathname === '/api/recruitment-records' && req.method === 'GET') {
      if (project?.id !== 'recruitment') return send(res, 404, { error: 'Disponible solo para Recruitment.' });
      const env = parse(await readEnv(project));
      return send(res, 200, recruitmentRecords(env, project.base, url.searchParams.get('before')));
    }
    if (['/api/daily-report', '/api/audit'].includes(url.pathname) && req.method === 'GET') {
      if (project?.id !== 'wow') return send(res, 404, { error: 'Disponible solo para WoW Role Sync.' });
      const env = parse(await readEnv(project));
      if (url.pathname === '/api/daily-report') return send(res, 200, await dailyReport(env, project.base, await state(env, project)));
      try { return send(res, 200, readAudit(env, project.base, url.searchParams)); }
      catch { return send(res, 503, { error: 'No se pudieron consultar los registros. Comprueba SQLite y los permisos.' }); }
    }
    if (url.pathname === '/api/restart' && req.method === 'POST') {
      if (req.headers['x-panel-csrf'] !== csrf) return send(res, 403, { error: 'Recarga el panel para reiniciar.' });
      if (!project) return send(res, 404, { error: 'Bot desconocido.' });
      if (!restartEnabled) return send(res, 403, { error: 'Reinicio deshabilitado. Configura PANEL_RESTART_ENABLED=true en el servidor.' });
      if (saving) return send(res, 409, { error: 'Hay otro guardado o reinicio en curso.' });
      saving = true;
      try {
        const current = await readEnv(project);
        if (req.headers['x-panel-revision'] !== revision(current)) return send(res, 409, { error: 'La configuración ha cambiado. Recarga antes de reiniciar.' });
        const service = project.id === 'roulette' ? 'whitebird-wow-wheel' : 'bot';
        try {
          await execute('docker', ['compose', 'up', '-d', '--no-deps', '--force-recreate', service], {
            cwd: project.base, timeout: 120000, maxBuffer: 1024 * 1024,
            // La configuración de Compose debe venir del .env del bot, no del panel.
            env: Object.fromEntries(Object.entries(process.env).filter(([key]) =>
              ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'XDG_RUNTIME_DIR'].includes(key)))
          });
        } catch (error) {
          const timeout = error.killed ? ' Se agotó el tiempo; comprueba el contenedor antes de repetir.' : '';
          return send(res, 502, { error: `No se pudo confirmar la recreación del bot. Comprueba Docker Compose y los permisos del usuario del panel.${timeout} La configuración sigue guardada.` });
        }
        return send(res, 200, { ok: true, message: `${project.name}: contenedor recreado con la configuración guardada. Esto no confirma la conexión a Discord.` });
      } finally { saving = false; }
    }
    if (url.pathname === '/api/config' && (!project || !project.path)) return send(res, 404, { error: 'Bot no integrado o desconocido.' });
    if (url.pathname === '/api/config' && req.method === 'GET') {
      const text = await readEnv(project);
      return send(res, 200, { ...view(text, project.modules), project: { id: project.id, name: project.name }, restartEnabled, csrf, state: await state(parse(text), project), runtime: 'Configuración guardada en disco. El panel no verifica el proceso ni la conexión en vivo con Discord.' });
    }
    if (url.pathname === '/api/config' && req.method === 'PUT') {
      if (req.headers['x-panel-csrf'] !== csrf) return send(res, 403, { error: 'Recarga el panel para guardar.' });
      if (saving) return send(res, 409, { error: 'Hay otro guardado o reinicio en curso.' });
      saving = true;
      try {
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 64000) return send(res, 413, { error: 'Petición demasiado grande.' }); }
        const input = JSON.parse(body);
        const current = await readEnv(project);
        if (input.revision !== revision(current)) return send(res, 409, { error: 'La configuración ha cambiado. Recarga antes de guardar.' });
        const next = update(current, input.changes, project.modules);
        const temp = `${project.path}.${randomBytes(8).toString('hex')}.tmp`;
        try { await writeFile(temp, next, { mode: 0o600, flag: 'wx' }); await rename(temp, project.path); }
        finally { await unlink(temp).catch(() => {}); }
        return send(res, 200, { ok: true, message: 'Guardado. Recrea el contenedor del bot para aplicar los cambios.' });
      } finally { saving = false; }
    }
    const files = { '/agent.js': ['agent.js', 'text/javascript'], '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/help.js': ['help.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/logo.png': ['logo.png', 'image/png'] };
    if (req.method === 'GET' && files[req.url]) {
      const [file, type] = files[req.url];
      res.setHeader('Content-Type', type.startsWith('text/') ? `${type}; charset=utf-8` : type); return res.end(await readFile(join(here, 'public', file)));
    }
    send(res, 404, { error: 'No encontrado.' });
  } catch (error) { send(res, 400, { error: error.code ? 'No se pudo acceder a la configuración. Comprueba permisos y rutas.' : error.message }); }
});
return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PANEL_PORT || 3080);
  createPanel({ port }).listen(port, '127.0.0.1', () => console.log(`Whitebird Control: http://127.0.0.1:${port}`));
}

