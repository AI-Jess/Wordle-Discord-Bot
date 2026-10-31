// store.js — the bot's memory, saved as one JSON file. On GitHub it lives on
// the repo's `data` branch, so the code branch stays clean and history
// survives any computer change. Same shape as the old iCloud store.json, so
// an old file can be dropped in as-is.

const fs = require('fs');
const path = require('path');

const FILE = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'store.json');
const MAX_PROCESSED = 500;

function blank() {
  return {
    dailyResults: {},               // "YYYY-MM-DD" -> { displayName: tries } (7 = X)
    reminderState: { sentForDate: null },
    processedMessageIds: [],
    posted: {},                     // weekly/monthly/yearly -> last period key posted
    config: {}
  };
}

function load() {
  if (!fs.existsSync(FILE)) return blank();
  const data = { ...blank(), ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  data.reminderState = data.reminderState || { sentForDate: null };
  data.posted = data.posted || {};
  data.processedMessageIds = data.processedMessageIds || [];
  return data;
}

function save(data) {
  data.processedMessageIds = data.processedMessageIds.slice(-MAX_PROCESSED);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n');
}

function record(data, dateStr, name, tries) {
  (data.dailyResults[dateStr] ||= {})[name] = tries;
}

// Drops results older than `keepFrom` (YYYY-MM-DD). Called after the yearly
// wrap posts. Keeps the last two weeks of the old year so the first weekly
// recap of January still has its comparison week.
function purgeBefore(data, keepFrom) {
  for (const d of Object.keys(data.dailyResults)) if (d < keepFrom) delete data.dailyResults[d];
}

module.exports = { load, save, record, purgeBefore, FILE };
