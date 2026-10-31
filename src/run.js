// run.js — everything the bot does, as one-shot commands that GitHub Actions
// runs on a schedule (or when you press "Run workflow").
//
//   node src/run.js tick         hourly: log new scores, maybe remind, post any recap that's due
//   node src/run.js reminder     send today's reminder now
//   node src/run.js wrap-week    recap (PERIOD=current|previous)
//   node src/run.js wrap-month   recap (PERIOD=current|previous)
//   node src/run.js wrap-year    recap (PERIOD=current|previous)
//   node src/run.js log-result   NAME=… TRIES=1-7 DATE=YYYY-MM-DD
//   node src/run.js backfill     re-read the channel since Jan 1 and log every summary found
//
// Recaps from manual runs are only previewed (in the run summary) unless POST=true.

const fs = require('fs');
const store = require('./store');
const discord = require('./discord');
const parser = require('./parser');
const recap = require('./recap');
const { ctParts, addDays, mondayOf } = require('./time');

const WINDOW_START = 9;   // reminder window, Central Time (start hour)
const WINDOW_END = 21;    // reminder must go out before 9 PM
const RECAP_HOUR = 19;    // scheduled recaps post at/after 7 PM Central

const env = process.env;
const log = (...a) => console.log('[wordle]', ...a);

function summary(md) {
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, md + '\n\n');
  console.log(md);
}

function cfg(data) {
  const channelId = env.DISCORD_CHANNEL_ID || data.config.channelId;
  if (!channelId) throw new Error('No channel set. Add DISCORD_CHANNEL_ID as a repository variable.');
  return { channelId, roleId: env.DISCORD_ROLE_ID || data.config.roleId || null };
}

function withRole(c, payload) {
  if (!c.roleId) return { ...payload, allowed_mentions: { parse: [] } };
  return { ...payload, content: `<@&${c.roleId}> ${payload.content || ''}`.trim(), allowed_mentions: { roles: [c.roleId] } };
}

// ---------- Score logging ----------

async function ingest(data, sinceDate, { reprocess = false } = {}) {
  const c = cfg(data);
  const bot = await discord.me();
  if (!data.config.guildId) data.config.guildId = (await discord.channel(c.channelId)).guild_id;
  const names = {};
  const nameOf = async id => {
    if (names[id]) return names[id];
    try {
      const m = await discord.member(data.config.guildId, id);
      names[id] = m.nick || m.user.global_name || m.user.username;
    } catch {
      try { const u = await discord.user(id); names[id] = u.global_name || u.username; } catch { names[id] = id; }
    }
    return names[id];
  };

  let before = null, logged = 0, scanned = 0;
  outer: for (let page = 0; page < 60; page++) {
    const batch = await discord.messages(c.channelId, before);
    if (!batch.length) break;
    for (const msg of batch) {
      scanned++;
      const postedCT = ctParts(new Date(msg.timestamp)).date;
      if (postedCT < sinceDate) break outer;
      if (!parser.isWordleMessage(msg, bot.id)) continue;
      if (!reprocess && data.processedMessageIds.includes(msg.id)) continue;
      const scores = parser.parseWordleMessage(msg);
      // The summary reports on the day before it was posted.
      const day = ctParts(new Date(Date.parse(msg.timestamp) - 864e5)).date;
      for (const { userId, tries } of scores) {
        store.record(data, day, await nameOf(userId), tries);
        logged++;
      }
      if (!data.processedMessageIds.includes(msg.id)) data.processedMessageIds.push(msg.id);
      if (scores.length) log(`Logged ${scores.length} scores for ${day}`);
    }
    before = batch[batch.length - 1].id;
  }
  log(`Scanned ${scanned} messages, logged ${logged} scores.`);
}

// ---------- Reminder ----------

async function sendReminder(data, today) {
  const c = cfg(data);
  await discord.send(c.channelId, withRole(c, {
    content: "🟨 Reminder: today's Wordle is up whenever you're ready! First one here, run `/wordle` to kick it off for the group. Everyone else can join right in."
  }));
  data.reminderState.sentForDate = today;
  log('Reminder sent.');
}

// One random hour between 9 AM and 8 PM: each hourly check sends with
// chance 1 / (hours left in the window), so every hour is equally likely
// and the 8 PM check always sends if nothing went out yet.
async function maybeReminder(data, now) {
  if (data.reminderState.sentForDate === now.date) return;
  if (now.hour < WINDOW_START || now.hour >= WINDOW_END) return;
  const hoursLeft = WINDOW_END - now.hour;
  if (Math.random() < 1 / hoursLeft) await sendReminder(data, now.date);
  else log(`No reminder this hour (1 in ${hoursLeft} chance).`);
}

// ---------- Recaps ----------

const periods = {
  week: now => {
    const thisMonday = mondayOf(now.date);
    const prevMonday = addDays(thisMonday, -7);
    return {
      current: { key: thisMonday, build: d => recap.weekly(d, thisMonday, now.date) },
      previous: { key: prevMonday, build: d => recap.weekly(d, prevMonday, addDays(prevMonday, 6)) }
    };
  },
  month: now => {
    const cur = now.date.slice(0, 7);
    const prev = addDays(`${cur}-01`, -1).slice(0, 7);
    return { current: { key: cur, build: d => recap.monthly(d, cur) }, previous: { key: prev, build: d => recap.monthly(d, prev) } };
  },
  year: now => {
    const cur = String(now.year), prev = String(now.year - 1);
    return { current: { key: cur, build: d => recap.yearly(d, cur) }, previous: { key: prev, build: d => recap.yearly(d, prev) } };
  }
};

async function postRecap(data, embed) {
  const c = cfg(data);
  await discord.send(c.channelId, withRole(c, { embeds: [embed] }));
  log(`Posted: ${embed.title}`);
}

// A recap is due once its period has ended and it's 7 PM or later on the
// first day after (or any time after that, if a run was missed).
function due(kind, now, lastPosted) {
  const prev = periods[kind](now).previous;
  if (lastPosted === prev.key) return null;
  const firstDay = { week: mondayOf(now.date), month: `${now.date.slice(0, 7)}-01`, year: `${now.year}-01-01` }[kind];
  if (now.date === firstDay && now.hour < RECAP_HOUR) return null;
  return prev;
}

async function maybeRecaps(data, now) {
  for (const kind of ['week', 'month', 'year']) {
    const p = due(kind, now, data.posted[kind]);
    if (!p) continue;
    await postRecap(data, p.build(data));
    data.posted[kind] = p.key;
    if (kind === 'year') {
      store.purgeBefore(data, addDays(`${now.year}-01-01`, -14));
      log(`Cleared results from before ${now.year} (kept the last two weeks for January's first recap).`);
    }
  }
}

// ---------- Commands ----------

async function main() {
  const cmd = process.argv[2] || 'tick';
  if (cmd === 'tick' && !env.DISCORD_TOKEN) {
    log('Not set up yet: add the DISCORD_TOKEN secret. Skipping this run.');
    return;
  }
  const now = ctParts();
  const data = store.load();

  // First run ever: mark current periods as already posted so turning the
  // bot on mid-week doesn't fire off a stack of old recaps.
  if (!data.posted.initialized) {
    for (const k of ['week', 'month', 'year']) data.posted[k] = periods[k](now).previous.key;
    data.posted.initialized = now.date;
  }

  if (cmd === 'tick') {
    await ingest(data, addDays(now.date, -3));
    await maybeReminder(data, now);
    await maybeRecaps(data, now);
  } else if (cmd === 'reminder') {
    await sendReminder(data, now.date);
  } else if (cmd.startsWith('wrap-')) {
    const kind = cmd.slice(5);
    if (!periods[kind]) throw new Error(`Unknown recap "${cmd}". Use wrap-week, wrap-month or wrap-year.`);
    if (env.SKIP_INGEST !== 'true') await ingest(data, addDays(now.date, -3));
    const p = periods[kind](now)[env.PERIOD === 'previous' ? 'previous' : 'current'];
    const embed = p.build(data);
    if (env.POST === 'true') await postRecap(data, embed);
    else summary(`> Preview only. Run again with **post** checked to send it to Discord.\n\n${recap.toMarkdown(embed)}`);
  } else if (cmd === 'log-result') {
    const tries = Number(env.TRIES);
    if (!env.NAME || !(tries >= 1 && tries <= 7)) throw new Error('log-result needs a name and tries from 1 to 6 (7 = X).');
    const date = env.DATE || addDays(now.date, -1);
    store.record(data, date, env.NAME, tries);
    summary(`Logged ${tries === 7 ? 'X' : tries}/6 for ${env.NAME} on ${date}.`);
  } else if (cmd === 'backfill') {
    await ingest(data, env.SINCE || `${now.year}-01-01`, { reprocess: true });
    summary(`Backfill done. ${Object.keys(data.dailyResults).length} days of results on file.`);
  } else {
    throw new Error(`Unknown command "${cmd}".`);
  }

  store.save(data);
}

main().catch(err => { console.error(err.message); process.exit(1); });
