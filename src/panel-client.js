const allowedTools = new Set(['recruitment_summary', 'recruitment_recent', 'wow_links', 'wow_sync_history', 'wow_cauldrons', 'wow_bis_summary', 'wow_promotions', 'list_projects', 'read_config', 'prepare_config', 'prepare_restart', 'runtime_state', 'read_logs', 'discord_permissions', 'diagnose']);

export function createPanelClient({ url = process.env.PANEL_TOOLS_URL || 'http://127.0.0.1:3080', token = process.env.PANEL_TOOLS_TOKEN, fetchFn = fetch } = {}) {
  if (!url || !token) return null;
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || typeof token !== 'string' || token.length < 32) throw Error('Configure a loopback PANEL_TOOLS_URL and PANEL_TOOLS_TOKEN of at least 32 characters');
  async function request(body, signal) {
    const response = await fetchFn(new URL('/api/agent-tools', endpoint), {
      method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000)
    });
    if (!response.ok) throw Error(`Panel tools HTTP ${response.status}`);
    const result = await response.json();
    if (JSON.stringify(result).length > 131072) throw Error('Panel tools response too large');
    return result;
  }
  return {
    async listTools(signal) {
      const result = await request(null, signal);
      if (!Array.isArray(result.tools)) throw Error('Invalid panel tools');
      return result.tools.filter(tool => allowedTools.has(tool.name));
    },
    call(tool, args, actor, signal) {
      if (!allowedTools.has(tool)) throw Error('Forbidden panel tool');
      return request({ tool, arguments: args, actor }, signal);
    },
    action(action, id, actor) {
      if (!['save', 'apply', 'status', 'cancel'].includes(action) || !/^[a-f0-9]{32}$/.test(id)) throw Error('Invalid panel action');
      return request({ action, id, actor });
    }
  };
}
