import { WhitebirdMcpClient } from '@whitebird/wowaudit-mcp';
import { askWhitebird } from './agent.js';
const question = process.argv.slice(2).join(' ').trim();
if (!question) { console.error('Usage: npm run ask -- "¿Quién necesita X?"'); process.exit(2); }
const client = new WhitebirdMcpClient();
try {
  await client.connect();
  const result = await askWhitebird(question, client);
  console.log(`Tool: ${result.tool || 'none'}\n${result.answer}`);
} catch(e) {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
} finally { await client.close(); }
