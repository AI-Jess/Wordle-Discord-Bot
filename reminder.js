// reminder.js
// Schedules one random reminder per day within a configurable window
// (default 9am-9pm, Central time), pinging the whole channel — no opt-in
// required, since not everyone in the server necessarily wants to play.
//
// IMPORTANT: this file computes Central Time manually using the actual US
// daylight-saving rule, instead of relying on the host's timezone database
// (via Intl timeZone options). Many lightweight hosting images (Alpine-based
// Docker containers in particular) don't ship timezone data at all, and
// silently fall back to UTC with no error — which is what caused reminders
// to fire 5 hours early. This approach doesn't depend on that data existing.
//
// Reminder state (today's picked time, and whether it's already been sent)
// is persisted to disk. That way, if the host restarts or sleeps through
// the scheduled instant, we don't reroll a new random time or send a
// duplicate — and if we come back online AFTER today's window already
// closed without having sent it, we catch up by sending immediately.
//
// IMPORTANT: only ONE node-schedule job should ever be pending at a time.
// scheduleNextReminder() is called from several places (startup, after a
// job fires, and a periodic 15-minute safety recheck in index.js) — if each
// call created a new job without canceling the previous one, multiple jobs
// could end up scheduled for the same instant and all fire together. The
// module-level `currentJob` tracks and cancels the previous job before ever
// creating a new one.

const schedule = require('node-schedule');
const storage = require('./storage');

const WINDOW_START_HOUR = 9;
const WINDOW_END_HOUR = 21;

let currentJob = null;

function nthSundayUtcDay(year, monthIndex, nth) {
  const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
  const firstDow = firstOfMonth.getUTCDay();
  const firstSunday = 1 + ((7 - firstDow) % 7);
  return firstSunday + (nth - 1) * 7;
}

function isCentralDST(utcInstant) {
  const year = utcInstant.getUTCFullYear();
  const marchSecondSunday = nthSundayUtcDay(year, 2, 2);
  const novFirstSunday = nthSundayUtcDay(year, 10, 1);
  const dstStart = Date.UTC(year, 2, marchSecondSunday, 8, 0, 0);
  const dstEnd = Date.UTC(year, 10, novFirstSunday, 7, 0, 0);
  const t = utcInstant.getTime();
  return t >= dstStart && t < dstEnd;
}

function centralOffsetHours(utcInstant) {
  return isCentralDST(utcInstant) ? -5 : -6;
}

function centralDateParts(referenceInstant) {
  const roughOffset = centralOffsetHours(referenceInstant);
  const shifted = new Date(referenceInstant.getTime() + roughOffset * 3600 * 1000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

function centralTimeAt(referenceInstant, hour, minute = 0, second = 0) {
  const { year, month, day } = centralDateParts(referenceInstant);
  let offset = centralOffsetHours(referenceInstant);
  let candidate = new Date(Date.UTC(year, month, day, hour - offset, minute, second));
  const refinedOffset = centralOffsetHours(candidate);
  if (refinedOffset !== offset) {
    candidate = new Date(Date.UTC(year, month, day, hour - refinedOffset, minute, second));
  }
  return candidate;
}

function todayDateStr() {
  const { year, month, day } = centralDateParts(new Date());
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatCentral(date) {
  const offset = centralOffsetHours(date);
  const label = offset === -5 ? 'CDT' : 'CST';
  const shifted = new Date(date.getTime() + offset * 3600 * 1000);
  const hours24 = shifted.getUTCHours();
  const hour12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const ampm = hours24 < 12 ? 'AM' : 'PM';
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[shifted.getUTCMonth()]} ${shifted.getUTCDate()}, ${hour12}:${minutes} ${ampm} ${label}`;
}

function isWithinTodayWindow(now) {
  const windowStart = centralTimeAt(now, WINDOW_START_HOUR);
  const windowEnd = centralTimeAt(now, WINDOW_END_HOUR);
  return now >= windowStart && now <= windowEnd;
}

function pickRandomTimeForDay(referenceDay) {
  const windowStart = centralTimeAt(referenceDay, WINDOW_START_HOUR);
  const windowEnd = centralTimeAt(referenceDay, WINDOW_END_HOUR);
  const now = new Date();

  const earliestValid = now > windowStart ? now : windowStart;
  const rangeMs = windowEnd.getTime() - earliestValid.getTime();

  if (rangeMs <= 0) return null;
  const offset = Math.floor(Math.random() * rangeMs);
  return new Date(earliestValid.getTime() + offset);
}

function resolveNextReminderTime() {
  const today = todayDateStr();
  const state = storage.getReminderState();

  if (state.scheduledForDate === today && state.scheduledAt) {
    const existing = new Date(state.scheduledAt);
    if (existing.getTime() > Date.now()) {
      return existing;
    }
  }

  let referenceDay = new Date();
  let when = pickRandomTimeForDay(referenceDay);
  if (!when) {
    referenceDay = new Date(referenceDay.getTime() + 24 * 60 * 60 * 1000);
    when = pickRandomTimeForDay(referenceDay);
  }

  const { year, month, day } = centralDateParts(when);
  const forDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  storage.setReminderState({ scheduledForDate: forDateStr, scheduledAt: when.toISOString() });
  return when;
}

async function sendReminder(client) {
  const today = todayDateStr();
  const state = storage.getReminderState();

  if (state.sentForDate === today) {
    return;
  }

  const config = storage.getConfig();
  if (!config.channelId) return;

  const channel = await client.channels.fetch(config.channelId).catch(() => null);
  if (!channel) return;

  const text = `🟨 Reminder: today's Wordle is up whenever you're ready! First one here, run \`/wordle\` to kick it off for the group — everyone else can join right in.`;

  if (!config.roleId) {
    await channel.send(text);
  } else {
    await channel.send({
      content: `${text} <@&${config.roleId}>`,
      allowedMentions: { roles: [config.roleId] }
    });
  }

  storage.setReminderState({ sentForDate: today });
}

function scheduleNextReminder(client) {
  if (currentJob) {
    currentJob.cancel();
    currentJob = null;
  }

  const today = todayDateStr();
  const state = storage.getReminderState();

  if (state.sentForDate !== today) {
    const now = new Date();
    const pickedTimeAlreadyPassed =
      state.scheduledForDate === today && state.scheduledAt && new Date(state.scheduledAt).getTime() <= now.getTime();

    if (isWithinTodayWindow(now) && pickedTimeAlreadyPassed) {
      console.log("[reminder] Missed today's scheduled time (host was likely offline) — sending now instead.");
      sendReminder(client).then(() => scheduleNextReminder(client));
      return;
    }
  }

  const when = resolveNextReminderTime();
  console.log(`[reminder] Next Wordle reminder scheduled for ${formatCentral(when)}`);

  currentJob = schedule.scheduleJob(when, async () => {
    currentJob = null;
    await sendReminder(client);
    scheduleNextReminder(client);
  });
}

module.exports = {
  scheduleNextReminder,
  sendReminder,
  centralTimeAt,
  centralDateParts,
  formatCentral
};