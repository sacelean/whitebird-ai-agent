import test from 'node:test';
import assert from 'node:assert/strict';
import { discordConfig, createDiscordHandler } from '../src/discord.js';
import { createAgentServer } from '../src/server.js';

const env = { DISCORD_BOT_TOKEN: 'fake', DISCORD_APPLICATION_ID: '100000000000000001', DISCORD_GUILD_ID: '100000000000000002', DISCORD_CHANNEL_IDS: '100000000000000003', DISCORD_ROLE_IDS: '100000000000000004', AGENT_API_TOKEN: 'a'.repeat(32) };
const config = discordConfig(env);
function interaction(overrides = {}) {
  const messages = [];
  return { messages, isChatInputCommand: () => true, commandName: 'whitebird-ask', guildId: config.guildId, channelId: config.channels[0], member: { roles: config.roles }, user: { id: 'user' }, options: { getString: () => ' Eventos ' }, reply: async data => messages.push(data), deferReply: async data => messages.push(data), editReply: async data => messages.push(data), ...overrides };
}
test('Discord config fails closed for missing authorization lists and remote URLs', () => {
  for (const changes of [{ DISCORD_ROLE_IDS: '' }, { DISCORD_CHANNEL_IDS: '' }, { DISCORD_GUILD_ID: 'bad' }, { DISCORD_AGENT_URL: 'https://example.com' }, { DISCORD_AGENT_URL: 'http://127.0.0.1/path' }, { AGENT_API_TOKEN: '' }]) assert.throws(() => discordConfig({ ...env, ...changes }));
});
test('unauthorized guild, channel, roles and DMs never query the agent', async () => {
  const handle = createDiscordHandler(config, { fetchFn: () => assert.fail('unauthorized request') });
  for (const overrides of [{ guildId: null }, { guildId: 'other' }, { channelId: 'other' }, { member: { roles: [] } }, { member: null }]) {
    const i = interaction(overrides); await handle(i); assert.equal(i.messages[0].flags, 64); assert.match(i.messages[0].content, /acceso/);
  }
});
test('Discord reaches real HTTP contract, disables mentions and enforces cooldown', async t => {
  const server = createAgentServer({ client: {}, token: config.agentToken, ask: async q => ({ answer: `@everyone ${q}` }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const handle = createDiscordHandler({ ...config, url: `http://127.0.0.1:${server.address().port}` });
  const i = interaction(); await handle(i);
  assert.equal(i.messages[0].flags, 64);
  assert.equal(i.messages[1].content, '@everyone Eventos');
  assert.deepEqual(i.messages[1].allowedMentions, { parse: [] });
  const again = interaction(); await handle(again); assert.match(again.messages[0].content, /30 segundos/);
});
test('concurrency is rejected and failures release the slot without exposing secrets', async () => {
  let release, entered;
  const started = new Promise(r => { entered = r; });
  const waiting = new Promise(r => { release = r; });
  const handle = createDiscordHandler(config, { fetchFn: async () => { entered(); await waiting; throw Error('secret'); } });
  const first = interaction(); const work = handle(first); await started;
  const second = interaction({ user: { id: 'second' } }); await handle(second); assert.match(second.messages[0].content, /ocupado/);
  release(); await work;
  assert.doesNotMatch(first.messages[1].content, /secret/);
  const third = interaction({ user: { id: 'third' } }); await handle(third); assert.equal(third.messages.length, 2);
});
test('upstream busy status and oversized answers are adapted to Discord', async () => {
  for (const response of [{ status: 429 }, { ok: true, json: async () => ({ answer: 'x'.repeat(2500) }) }]) {
    const i = interaction(); await createDiscordHandler(config, { fetchFn: async () => response })(i);
    assert.ok(i.messages[1].content.length <= 2000);
    assert.match(i.messages[1].content, response.status === 429 ? /ocupado/ : /recortada/);
  }
});
