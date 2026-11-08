import { WhitebirdMcpClient } from '@whitebird/wowaudit-mcp';
import { validateLocalUrl } from '../src/agent.js';

const modelUrl = validateLocalUrl(process.env.LLAMA_CHAT_URL);
const healthUrl = new URL('/health', modelUrl);
const health = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) });
if (!health.ok) throw new Error(`Model health check failed: HTTP ${health.status}`);
const client = new WhitebirdMcpClient();
try {
  await Promise.race([
    client.connect(),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('MCP connection timed out')), 30000);
      timer.unref();
    }),
  ]);
  const supported = new Set(['team_audit', 'list_events', 'get_event', 'event_insights',
    'loot_history', 'trinket_status', 'wishlist_upgrades', 'find_recipe_crafters']);
  if (!client.listAllowedTools().some(tool => supported.has(tool.name))) {
    throw new Error('No supported read tools available');
  }
  console.log('Local model and WoWAudit MCP checks passed');
} finally {
  await client.close();
}
