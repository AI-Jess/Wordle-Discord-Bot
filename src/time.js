// time.js — Central Time helpers. GitHub's runners ship full timezone data,
// so Intl handles daylight saving correctly here (the old manual DST math
// was only needed for bare-bones hosts that lacked it).

const TZ = 'America/Chicago';

function ctParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(date);
  const get = t => parts.find(p => p.type === t).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    year: +get('year'), month: +get('month'), day: +get('day'),
    hour: +get('hour') % 24, weekday: get('weekday') // Mon, Tue, ...
  };
}

// Pure calendar math on YYYY-MM-DD strings (timezone-free).
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function mondayOf(dateStr) {
  const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay(); // 0 = Sun
  return addDays(dateStr, -((dow + 6) % 7));
}

function daysBetween(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const short = d => `${MONTHS[+d.slice(5, 7) - 1].slice(0, 3)} ${+d.slice(8, 10)}`;
const weekday = d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(d + 'T12:00:00Z').getUTCDay()];

module.exports = { ctParts, addDays, mondayOf, daysBetween, MONTHS, short, weekday };
