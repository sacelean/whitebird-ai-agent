import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const id = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
export function discordConfig(env = process.env) {
  const channels = (env.DISCORD_CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const roles = (env.DISCORD_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!env.DISCORD_BOT_TOKEN || !id(env.DISCORD_APPLICATION_ID) || !id(env.DISCORD_GUILD_ID)
    || !channels.length || !roles.length || ![...channels, ...roles].every(id)) throw Error('Configure Discord token, application, guild, channels and roles');
  const url = new URL(env.DISCORD_AGENT_URL || 'http://127.0.0.1:3090');
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Discord agent URL must be loopback');
  if (!env.AGENT_API_TOKEN || env.AGENT_API_TOKEN.length < 32) throw Error('AGENT_API_TOKEN required');
  return { token: env.DISCORD_BOT_TOKEN, applicationId: env.DISCORD_APPLICATION_ID, guildId: env.DISCORD_GUILD_ID, channels, roles, url: url.origin, agentToken: env.AGENT_API_TOKEN };
}

export const command = {
  name: 'whitebird-ask', description: 'Pregunta sobre los bots de Whitebird y consulta WoWAudit',
  options: [{ type: 3, name: 'pregunta', description: 'Tu pregunta (solo lectura)', required: true, min_length: 1, max_length: 1000 }]
};

function actionComponents(proposal) {
  if (!proposal) return [];
  const actions = proposal.state === 'prepared' ? [['save', 'Guardar'], ['cancel', 'Cancelar']]
    : proposal.state === 'saved' ? [['apply', 'Aplicar y reiniciar'], ['cancel', 'Cerrar propuesta']]
    : ['applying', 'apply_failed'].includes(proposal.state) ? [['status', 'Estado']] : [];
  if (!actions.length) return [];
  return [{ type: 1, components: actions.map(([action, label]) => ({ type: 2, style: action === 'save' || action === 'apply' ? 1 : 2,
    label, custom_id: `whitebird:${action}:${proposal.id}`, disabled: action === 'apply' && !proposal.canApply })) }];
}

async function deliver(interaction, data) {
  if (!data.proposal) {
    const content = data.answer.length > 1900 ? `${data.answer.slice(0, 1800)}\n\n[Respuesta recortada; concreta la pregunta para obtener más detalle.]` : data.answer;
    return interaction.editReply({ content, allowedMentions: { parse: [] } });
  }
  // Show the entire proposal before enabling its confirmation controls.
  let remaining = data.answer;
  const parts = [];
  while (remaining.length > 1800) {
    let end = remaining.lastIndexOf('\n', 1800);
    if (end < 1) end = 1800;
    parts.push(remaining.slice(0, end)); remaining = remaining.slice(end);
  }
  parts.push(remaining);
  for (let index = 0; index < parts.length; index++) {
    const message = { content: parts[index], allowedMentions: { parse: [] },
      components: index === parts.length - 1 ? actionComponents(data.proposal) : [] };
    if (index === 0) await interaction.editReply(message);
    else await interaction.followUp({ ...message, flags: 64 });
  }
}

export function createDiscordHandler(config, { fetchFn = fetch, now = Date.now } = {}) {
  const cooldowns = new Map();
  let busy = false;
  return async interaction => {
    const action = interaction.isButton?.() && /^whitebird:(save|apply|status|cancel):([a-f0-9]{32})$/.exec(interaction.customId);
    if (!action && (!interaction.isChatInputCommand() || interaction.commandName !== command.name)) return;
    const reply = content => interaction.reply({ content, flags: 64, allowedMentions: { parse: [] } });
    const memberRoles = interaction.member?.roles;
    const authorizedRole = config.roles.some(role => Array.isArray(memberRoles) ? memberRoles.includes(role) : memberRoles?.cache?.has(role));
    if (interaction.guildId !== config.guildId || !config.channels.includes(interaction.channelId) || !authorizedRole) {
      await reply('No tienes acceso al agente en este canal.'); return;
    }
    const question = action ? '' : interaction.options.getString('pregunta', true).trim();
    if (!action && (!question || question.length > 1000)) { await reply('La pregunta debe tener entre 1 y 1000 caracteres.'); return; }
    const time = now();
    for (const [user, expiry] of cooldowns) if (expiry <= time) cooldowns.delete(user);
    if (busy || (!action && cooldowns.has(interaction.user.id))) { await reply('El agente está ocupado o debes esperar 30 segundos entre consultas.'); return; }
    busy = true;
    if (!action) cooldowns.set(interaction.user.id, time + 30000);
    try {
      await interaction.deferReply({ flags: 64 });
      let content;
      try {
        const response = await fetchFn(`${config.url}${action ? '/actions' : '/ask'}`, {
          method: 'POST', headers: { Authorization: `Bearer ${config.agentToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...(action ? { action: action[1], id: action[2] } : { question }), actor: `discord:${interaction.guildId}:${interaction.user.id}` }), signal: AbortSignal.timeout(300000), redirect: 'error'
        });
        if (response.status === 429) content = 'El agente está ocupado. Inténtalo cuando termine la consulta actual.';
        else if (!response.ok) throw Error('Agent unavailable');
        else {
          const data = await response.json();
          if (typeof data.answer !== 'string' || !data.answer.trim()) throw Error('Invalid answer');
          await deliver(interaction, data);
          return;
        }
      } catch { content = 'No se pudo consultar al agente. Comprueba el servicio, el modelo y la sesión de WoWAudit.'; }
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
    } finally { busy = false; }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = discordConfig();
  const { Client, GatewayIntentBits, REST, Routes } = await import('discord.js');
  const rest = new REST({ version: '10' }).setToken(config.token);
  if (process.argv.includes('--register')) {
    // POST upserts only this command; preserve other commands in the application.
    await rest.post(Routes.applicationGuildCommands(config.applicationId, config.guildId), { body: command });
    console.log('Registered /whitebird-ask in the configured guild.');
  } else {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const handle = createDiscordHandler(config);
    client.on('interactionCreate', interaction => { handle(interaction).catch(() => console.error('Discord interaction failed.')); });
    client.on('error', () => console.error('Discord connection error.'));
    client.once('ready', () => console.log('Whitebird Discord connected.'));
    process.on('SIGINT', () => client.destroy());
    process.on('SIGTERM', () => client.destroy());
    try { await client.login(config.token); }
    catch { console.error('Discord login failed. Check bot configuration.'); client.destroy(); process.exitCode = 1; }
  }
}
