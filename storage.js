// storage.js
// Simple JSON-file-backed storage. Good enough for a friend-group bot.
// If you outgrow this (hundreds of users, need real querying), swap this
// module for a SQLite-backed version without touching the rest of the code.
//
// The data file lives inside iCloud Drive (not the project folder) so it
// syncs across machines automatically — no manual copying needed if you
// ever set the bot up on a new computer. os.homedir() is used instead of
// a hardcoded path so this still works if the username ever changes.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'WordleBotData');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const MAX_PROCESSED_IDS = 200;

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData(), null, 2));
  }
}

function defaultData() {
  return {
    dailyResults: {},
    reminderState: {
      scheduledForDate: null,
      scheduledAt: null,
      sentForDate: null
    },
    processedMessageIds: [],
    config: {
      guildId: null,
      channelId: null,
      roleId: null,
      timezone: 'America/Chicago'
    }
  };
}

function load() {
  ensureDataFile();
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.reminderState) {
    data.reminderState = { scheduledForDate: null, scheduledAt: null, sentForDate: null };
  }
  if (!data.processedMessageIds) {
    data.processedMessageIds = [];
  }
  return data;
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function recordResult(dateStr, displayName, tries) {
  const data = load();
  if (!data.dailyResults[dateStr]) data.dailyResults[dateStr] = {};
  data.dailyResults[dateStr][displayName] = tries;
  save(data);
}

function getResultsForDate(dateStr) {
  const data = load();
  return data.dailyResults[dateStr] || {};
}

function getAllResults() {
  return load().dailyResults;
}

function setConfig(partial) {
  const data = load();
  data.config = { ...data.config, ...partial };
  save(data);
}

function getConfig() {
  return load().config;
}

function getReminderState() {
  return load().reminderState;
}

function setReminderState(partial) {
  const data = load();
  data.reminderState = { ...data.reminderState, ...partial };
  save(data);
}

function isMessageProcessed(messageId) {
  return load().processedMessageIds.includes(messageId);
}

function markMessageProcessed(messageId) {
  const data = load();
  data.processedMessageIds.push(messageId);
  if (data.processedMessageIds.length > MAX_PROCESSED_IDS) {
    data.processedMessageIds = data.processedMessageIds.slice(-MAX_PROCESSED_IDS);
  }
  save(data);
}

/**
 * Deletes all dailyResults entries dated before the given year. Intended
 * to be called only right after the automatic Jan 1 annual wrap-up post —
 * not from the manual /wrap-year command — so on-demand checks later in
 * the year can never accidentally wipe data early.
 */
function purgeYearsBefore(year) {
  const data = load();
  const filtered = {};
  for (const dateStr in data.dailyResults) {
    const entryYear = parseInt(dateStr.slice(0, 4), 10);
    if (entryYear >= year) {
      filtered[dateStr] = data.dailyResults[dateStr];
    }
  }
  data.dailyResults = filtered;
  save(data);
}

module.exports = {
  recordResult,
  getResultsForDate,
  getAllResults,
  setConfig,
  getConfig,
  getReminderState,
  setReminderState,
  isMessageProcessed,
  markMessageProcessed,
  purgeYearsBefore
};