// stats.js — turns raw daily results into recap numbers.
// Scoring rule for recaps: a fail (X) counts as 7 guesses, so dodging a hard
// day by failing it never improves your average.

const { addDays, daysBetween } = require('./time');

function resultsIn(data, start, end) {
  const rows = [];
  for (const d of daysBetween(start, end)) {
    for (const [name, tries] of Object.entries(data.dailyResults[d] || {})) rows.push({ d, name, tries });
  }
  return rows;
}

function playerTable(rows) {
  const t = {};
  for (const r of rows) {
    const p = (t[r.name] ||= { name: r.name, games: 0, sum: 0, fails: 0, best: 8 });
    p.games++; p.sum += r.tries; if (r.tries === 7) p.fails++; p.best = Math.min(p.best, r.tries);
  }
  return Object.values(t).map(p => ({ ...p, avg: p.sum / p.games }));
}

// Consecutive days played, counting back from `end`.
function currentStreak(data, name, end) {
  let n = 0;
  for (let d = end; data.dailyResults[d]?.[name] !== undefined; d = addDays(d, -1)) n++;
  return n;
}

// Longest run of consecutive days played inside [start, end].
function longestRun(data, name, start, end) {
  let best = 0, cur = 0;
  for (const d of daysBetween(start, end)) {
    cur = data.dailyResults[d]?.[name] !== undefined ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

function improvement(data, start, end, minGames) {
  const len = daysBetween(start, end).length;
  const prev = playerTable(resultsIn(data, addDays(start, -len), addDays(start, -1)));
  const now = playerTable(resultsIn(data, start, end));
  let top = null;
  for (const p of now) {
    const q = prev.find(x => x.name === p.name);
    if (!q || p.games < minGames || q.games < minGames) continue;
    const drop = q.avg - p.avg;
    if (drop >= 0.2 && (!top || drop > top.drop)) top = { name: p.name, from: q.avg, to: p.avg, drop };
  }
  return top;
}

function toughestDay(rows) {
  const byDay = {};
  for (const r of rows) (byDay[r.d] ||= []).push(r.tries);
  let worst = null;
  for (const [d, arr] of Object.entries(byDay)) {
    if (arr.length < 3) continue;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    if (!worst || avg > worst.avg) worst = { d, avg, players: arr.length };
  }
  return worst;
}

function summarize(data, start, end, { minGames }) {
  const rows = resultsIn(data, start, end);
  const players = playerTable(rows);
  const ranked = players.filter(p => p.games >= minGames)
    .sort((a, b) => a.avg - b.avg || b.games - a.games);
  const unranked = players.filter(p => p.games < minGames).sort((a, b) => b.games - a.games);
  const bestScore = rows.length ? Math.min(...rows.map(r => r.tries)) : null;
  return {
    rows, players, ranked, unranked,
    groupAvg: rows.length ? rows.reduce((a, r) => a + r.tries, 0) / rows.length : null,
    best: bestScore && bestScore < 7 ? rows.filter(r => r.tries === bestScore) : [],
    fails: rows.filter(r => r.tries === 7),
    sixes: rows.filter(r => r.tries === 6),
    improved: improvement(data, start, end, minGames),
    toughest: toughestDay(rows),
    streaks: players.map(p => ({ name: p.name, n: currentStreak(data, p.name, end), longest: longestRun(data, p.name, start, end) }))
  };
}

module.exports = { summarize, resultsIn, playerTable, currentStreak };
