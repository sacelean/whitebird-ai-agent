import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { askWhitebird } from './agent.js';

export function createAgentServer({ client, token, port = 3090, ask = askWhitebird } = {}) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('AGENT_API_TOKEN must contain at least 32 characters');
  if (!client) throw new Error('MCP client required');
  let busy = false;
  const send = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    // No browser access: the panel backend is the only consumer.
    if (req.headers.host !== `127.0.0.1:${server.address().port}` || req.headers.origin) return send(res, 403, { error: 'Forbidden' });
    const supplied = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return send(res, 401, { error: 'Unauthorized' });
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { status: 'ok', busy });
    if (req.method !== 'POST' || req.url !== '/ask') return send(res, 404, { error: 'Not found' });
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return send(res, 415, { error: 'JSON required' });
    let input;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) { send(res, 413, { error: 'Request too large' }); return; }
        chunks.push(chunk);
      }
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { return send(res, 400, { error: 'Invalid JSON' }); }
    if (!input || typeof input.question !== 'string' || !input.question.trim() || input.question.trim().length > 1000) return send(res, 400, { error: 'Question must contain 1-1000 characters' });
    // Reject excess work rather than accumulate unbounded, potentially stale queries.
    if (busy) return send(res, 429, { error: 'El agente está ocupado. Espera a que termine la consulta actual.' });
    busy = true;
    try {
      const result = await ask(input.question.trim(), client);
      send(res, 200, result);
    } catch {
      // Never send upstream errors, OAuth details or model data to the caller.
      send(res, 502, { error: 'No se pudo completar la consulta. Comprueba el modelo y la sesión de WoWAudit.' });
    } finally { busy = false; }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.AGENT_PORT || 3090);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid AGENT_PORT');
  const { WhitebirdMcpClient } = await import('@whitebird/wowaudit-mcp');
  const client = new WhitebirdMcpClient();
  const server = createAgentServer({ client, token: process.env.AGENT_API_TOKEN, port });
  try {
    await client.connect();
    server.listen(port, '127.0.0.1', () => console.log(`Whitebird agent: http://127.0.0.1:${port}`));
    server.on('error', async () => { await client.close(); process.exitCode = 1; });
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      server.close(async () => { await client.close(); });
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  } catch {
    await client.close();
    console.error('Agent startup failed. Check MCP configuration and OAuth login.');
    process.exitCode = 1;
  }
}
