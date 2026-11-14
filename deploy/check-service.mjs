// This probes only the running HTTP service; never opens another OAuth session.
const port = Number(process.env.AGENT_PORT || 3090);
const token = process.env.AGENT_API_TOKEN;
if (!Number.isInteger(port) || port < 1 || port > 65535 || !token || token.length < 32) {
  throw new Error('Invalid agent service configuration');
}
let ready = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(1000)
    });
    const body = response.ok ? await response.json() : null;
    if (body?.status === 'ok') { ready = true; break; }
  } catch { /* Service may still be connecting to MCP. */ }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!ready) throw new Error('Agent service did not become healthy');
console.log('Agent HTTP service health check passed');
