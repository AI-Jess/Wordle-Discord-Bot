require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');
const schedule = require('node-schedule');

const storage = require('./storage');
const parser = require('./parser');
const reminder = require('./reminder');
const wrap = require('./wrap');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in your .env file.');
  process.exit(1);
}

process.on('unhandledRejection', err => {
  console.error('[fatal-guard] Unhandled rejection (bot is still running):', err);
});
process.on('uncaughtException', err => {
  console.error('[fatal-guard] Uncaught exception (bot is still running):', err);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // privileged intent — must enable in Dev Portal
  ]
});

// ---------- Slash command definitions ----------

const commands = [
  new SlashCommandBuilder()
    .setName('set-channel')
    .setDescription('Set this channel as the one the bot watches and posts in')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('wrap-month')
    .setDescription('Post this month\'s Wordle wrap-up now'),

  new SlashCommandBuilder()
    .setName('wrap-year')
    .setDescription('Post this year\'s Wordle wrap-up now'),

  new SlashCommandBuilder()
    .setName('log-result')
    .setDescription('Manually log a Wordle result (fallback if auto-detect misses it)')
    .addStringOption(opt => opt.setName('name').setDescription('Display name of who played').setRequired(true))
    .addIntegerOption(opt =>
      opt.setName('tries').setDescription('Tries (1-6), or 7 for a fail').setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('setup-reminder-button')
    .setDescription('Post a button people can click to opt in/out of Wordle reminders')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName('debug-last-wordle-message')
    .setDescription('Print the raw JSON of the most recent Wordle-looking message to bot logs')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('Slash commands registered.');
}

// ---------- Event handlers ----------

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  reminder.scheduleNextReminder(client);
  scheduleWraps();
  await catchUpMissedResults();

setInterval(() => {
    catchUpMissedResults().catch(err => console.log(`[tracking] Catch-up scan error: ${err.message}`));
  }, 15 * 60 * 1000);

  setInterval(() => {
    reminder.scheduleNextReminder(client);
  }, 15 * 60 * 1000);
});

const REMINDER_ROLE_NAME = 'Wordle';
const TOGGLE_BUTTON_ID = 'wordle-toggle-role';

function roleMentionContent() {
  const config = storage.getConfig();
  return config.roleId ? `<@&${config.roleId}>` : '';
}

client.on('interactionCreate', async interaction => {
  if (interaction.isButton() && interaction.customId === TOGGLE_BUTTON_ID) {
    const config = storage.getConfig();
    if (!config.roleId) {
      await interaction.reply({
        content: 'The reminder role isn\'t set up yet — ask an admin to run /setup-reminder-button.',
        ephemeral: true
      });
      return;
    }

    const member = interaction.member;
    const hasRole = member.roles.cache.has(config.roleId);

    if (hasRole) {
      await member.roles.remove(config.roleId).catch(() => null);
      await interaction.reply({ content: 'Removed — you won\'t get pinged for reminders anymore.', ephemeral: true });
    } else {
      await member.roles.add(config.roleId).catch(() => null);
      await interaction.reply({ content: 'You\'re in! You\'ll get pinged with the daily reminder.', ephemeral: true });
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'setup-reminder-button') {
    await interaction.deferReply({ ephemeral: true });
    const config = storage.getConfig();
    let role = config.roleId ? interaction.guild.roles.cache.get(config.roleId) : null;

    if (!role) {
      role = await interaction.guild.roles.create({
        name: REMINDER_ROLE_NAME,
        mentionable: true,
        reason: 'Role for opting into Wordle reminders'
      });
      storage.setConfig({ roleId: role.id });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(TOGGLE_BUTTON_ID)
        .setLabel('🟩 Join Wordle Reminders')
        .setStyle(ButtonStyle.Success)
    );

    await interaction.channel.send({
      content: 'Click below to get pinged for the daily Wordle reminder. Click again anytime to leave.',
      components: [row]
    });
    await interaction.editReply('Posted the button!');
  }

  if (interaction.commandName === 'set-channel') {
    storage.setConfig({ guildId: interaction.guildId, channelId: interaction.channelId });
    await interaction.reply({ content: `This channel is now set for Wordle tracking and reminders.` });
  }

  if (interaction.commandName === 'wrap-month') {
    const embed = wrap.buildMonthlyWrap();
    const config = storage.getConfig();
    await interaction.reply({
      content: roleMentionContent(),
      embeds: [embed],
      allowedMentions: config.roleId ? { roles: [config.roleId] } : { parse: [] }
    });
  }

  if (interaction.commandName === 'wrap-year') {
    const embed = wrap.buildYearlyWrap();
    const config = storage.getConfig();
    await interaction.reply({
      content: roleMentionContent(),
      embeds: [embed],
      allowedMentions: config.roleId ? { roles: [config.roleId] } : { parse: [] }
    });
  }

  if (interaction.commandName === 'log-result') {
    const name = interaction.options.getString('name');
    const tries = interaction.options.getInteger('tries');
    const { year, month, day } = reminder.centralDateParts(new Date());
    const today = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    storage.recordResult(today, name, tries);
    await interaction.reply({ content: `Logged ${tries === 7 ? 'X' : tries}/6 for ${name} on ${today}.` });
  }

  if (interaction.commandName === 'debug-last-wordle-message') {
    await interaction.deferReply({ ephemeral: true });
    const messages = await interaction.channel.messages.fetch({ limit: 50 });
    const candidates = messages.filter(m => parser.isLikelyWordleActivityMessage(m));

    if (candidates.size === 0) {
      await interaction.editReply('No Wordle-looking messages found in the last 50 messages.');
      return;
    }

    console.log(`--- FOUND ${candidates.size} WORDLE-LIKE MESSAGE(S) ---`);
    let i = 0;
    for (const candidate of candidates.values()) {
      i++;
      const looksLikeScoreSummary = /\d\/6|X\/6/i.test(candidate.content) ||
        candidate.embeds.some(e => /\d\/6|X\/6/i.test(`${e.title || ''} ${e.description || ''}`));
      console.log(`--- MESSAGE ${i}${looksLikeScoreSummary ? ' (looks like a score summary)' : ''} ---`);
      console.log(JSON.stringify({
        author: candidate.author.username,
        content: candidate.content,
        embeds: candidate.embeds.map(e => e.toJSON ? e.toJSON() : e)
      }, null, 2));
    }
    console.log('--- END ---');
    await interaction.editReply(`Printed ${candidates.size} message(s) to bot logs — check the logs and send that to me.`);
  }
});

// Listen for the official Wordle activity's messages to auto-log results.
// No opt-in needed — anyone whose name shows up in the activity's own
// summary gets tracked automatically for the wrap-up leaderboard.

async function processWordleResultMessage(message) {
  if (storage.isMessageProcessed(message.id)) return; // already handled

  console.log(`[tracking] Wordle-looking message detected from "${message.author?.username}" (id: ${message.id}).`);

  const parsed = parser.parseWordleMessage(message);
  if (parsed.length === 0) {
    console.log('[tracking] No scores in that message (likely an "is/was playing" notice, not a results summary) — nothing to record.');
    storage.markMessageProcessed(message.id);
    return;
  }

  // This message reports on YESTERDAY's game ("Here are yesterday's
  // results"), so results get recorded under yesterday's date, not today's.
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const { year, month, day } = reminder.centralDateParts(yesterday);
  const today = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const recordedNames = [];
  for (const { userId, tries } of parsed) {
    let displayName = userId;
    try {
      const member = await message.guild.members.fetch(userId);
      displayName = member.displayName || member.user.username;
    } catch (err) {
      console.log(`[tracking] Couldn't resolve user ID ${userId} to a server member — recording under the raw ID. Error: ${err.message}`);
    }
    storage.recordResult(today, displayName, tries);
    recordedNames.push(`${displayName}: ${tries === 7 ? 'X' : tries}/6`);
  }

  console.log(`[tracking] Recorded for ${today}: ${recordedNames.join(', ')}`);
  storage.markMessageProcessed(message.id);
}

// Runs once on startup: scans the last 20 messages in the tracked channel
// for any Wordle results summary that might have been missed while the bot
// was offline (e.g. the host recycling the container mid-day). Skips
// anything already processed, so this is safe to run every restart.
async function catchUpMissedResults() {
  console.log('[tracking] Running catch-up scan...');
  const config = storage.getConfig();
  if (!config.channelId) {
    console.log('[tracking] Catch-up scan: no channel configured, skipping.');
    return;
  }

  const channel = await client.channels.fetch(config.channelId).catch(err => {
    console.log(`[tracking] Catch-up scan: couldn't fetch channel — ${err.message}`);
    return null;
  });
  if (!channel) return;

  const messages = await channel.messages.fetch({ limit: 20 }).catch(err => {
    console.log(`[tracking] Catch-up scan: couldn't fetch messages — ${err.message}`);
    return null;
  });
  if (!messages) return;

  const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const wordleLike = sorted.filter(m => parser.isLikelyWordleActivityMessage(m));
  console.log(`[tracking] Catch-up scan: fetched ${sorted.length} messages, ${wordleLike.length} look Wordle-related.`);

  for (const message of wordleLike) {
    await processWordleResultMessage(message);
  }
  console.log('[tracking] Catch-up scan complete.');
}

client.on('messageCreate', async message => {
  const config = storage.getConfig();
  if (!config.channelId || message.channelId !== config.channelId) return;
  if (!parser.isLikelyWordleActivityMessage(message)) return;
  await processWordleResultMessage(message);
});

// ---------- Monthly / yearly wrap scheduling ----------
// Uses the same host-independent Central Time calculation as reminder.js
// (see that file for why: node-schedule's `tz` option and cron-style rules
// both rely on the host recognizing timezone names, which many lightweight
// hosting images don't have installed).

function nextCentralOccurrence(hour, minute) {
  const now = new Date();
  let candidate = reminder.centralTimeAt(now, hour, minute);
  if (candidate.getTime() <= now.getTime()) {
    candidate = reminder.centralTimeAt(new Date(now.getTime() + 24 * 60 * 60 * 1000), hour, minute);
  }
  return candidate;
}

function scheduleWraps() {
  scheduleDailyWrapCheck(9, 5, async () => {
    const { day } = reminder.centralDateParts(new Date());
    if (day !== 1) return; // only fires on the 1st of the month

    const config = storage.getConfig();
    if (!config.channelId) return;
    const channel = await client.channels.fetch(config.channelId).catch(() => null);
    if (!channel) return;

    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    const embed = wrap.buildMonthlyWrap(lastMonth);
    await channel.send({
      content: roleMentionContent(),
      embeds: [embed],
      allowedMentions: config.roleId ? { roles: [config.roleId] } : { parse: [] }
    });
  });

scheduleDailyWrapCheck(9, 10, async () => {
    const { day, month, year } = reminder.centralDateParts(new Date());
    if (day !== 1 || month !== 0) return; // only fires on Jan 1st

    const config = storage.getConfig();
    if (!config.channelId) return;
    const channel = await client.channels.fetch(config.channelId).catch(() => null);
    if (!channel) return;

    const lastYear = new Date();
    lastYear.setUTCFullYear(lastYear.getUTCFullYear() - 1);
    const embed = wrap.buildYearlyWrap(lastYear);
    await channel.send({
      content: roleMentionContent(),
      embeds: [embed],
      allowedMentions: config.roleId ? { roles: [config.roleId] } : { parse: [] }
    });

    // Now that the annual recap has posted, previous years' data is no
    // longer needed — only the manual /wrap-year command is exempt from
    // this, so on-demand checks can never accidentally wipe data early.
    storage.purgeYearsBefore(year);
    console.log(`[wrap] Purged Wordle history from before ${year}.`);
  });
}

// Runs `callback` once at hour:minute Central time every day, forever. The
// callback itself decides whether today is actually the day it cares about
// (see usages above).
function scheduleDailyWrapCheck(hour, minute, callback) {
  const when = nextCentralOccurrence(hour, minute);
  schedule.scheduleJob(when, async () => {
    await callback();
    scheduleDailyWrapCheck(hour, minute, callback);
  });
}

// ---------- Boot ----------

(async () => {
  await registerCommands();
  await client.login(TOKEN);
})();
