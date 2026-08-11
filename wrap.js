
// wrap.js
// Builds "Spotify Wrapped"-style summaries from stored daily results.

const { EmbedBuilder } = require('discord.js');
const storage = require('./storage');

function statsForPrefix(prefix) {
  const allResults = storage.getAllResults();

  const tally = {};

  for (const [dateStr, dayResults] of Object.entries(allResults)) {
    if (!dateStr.startsWith(prefix)) continue;
    for (const [displayName, tries] of Object.entries(dayResults)) {
      if (!tally[displayName]) tally[displayName] = { completed: 0, totalTries: 0, fails: 0 };
      tally[displayName].completed += 1;
      if (tries === 7) {
        tally[displayName].fails += 1;
      } else {
        tally[displayName].totalTries += tries;
      }
    }
  }

  const rows = Object.entries(tally).map(([displayName, s]) => {
    const solved = s.completed - s.fails;
    const avg = solved > 0 ? (s.totalTries / solved) : null;
    return {
      username: displayName,
      completed: s.completed,
      fails: s.fails,
      avgTries: avg
    };
  });

  return rows;
}

const round2 = n => (n === null ? null : Math.round(n * 100) / 100);

function buildWrapEmbed(prefix, label) {
  const rows = statsForPrefix(prefix);

  if (rows.length === 0) {
    return new EmbedBuilder()
      .setTitle(`Wordle Wrap: ${label}`)
      .setDescription('No results recorded for this period yet.')
      .setColor(0x6aaa64);
  }

  const withRounded = rows.map(r => ({ ...r, roundedAvg: round2(r.avgTries) }));

  const eligible = withRounded.filter(r => r.roundedAvg !== null);
  const bestAvgValue = eligible.length > 0 ? Math.min(...eligible.map(r => r.roundedAvg)) : null;
  const bestAvgNames = eligible.filter(r => r.roundedAvg === bestAvgValue).map(r => r.username);

  const embed = new EmbedBuilder()
    .setTitle(`🟩 Wordle Wrap: ${label}`)
    .setColor(0x6aaa64)
    .addFields({
      name: '🎯 Best Average Tries',
      value: bestAvgValue !== null
        ? `${bestAvgNames.join(', ')} — ${bestAvgValue.toFixed(2)} avg tries`
        : 'Not enough data yet'
    });

  const sortedRows = [...withRounded].sort((a, b) => {
    if (b.completed !== a.completed) return b.completed - a.completed;
    const aAvg = a.roundedAvg === null ? Infinity : a.roundedAvg;
    const bAvg = b.roundedAvg === null ? Infinity : b.roundedAvg;
    return aAvg - bAvg;
  });

  const groups = [];
  for (const row of sortedRows) {
    const last = groups[groups.length - 1];
    if (last && last.completed === row.completed && last.roundedAvg === row.roundedAvg) {
      last.names.push(row.username);
    } else {
      groups.push({ completed: row.completed, roundedAvg: row.roundedAvg, names: [row.username] });
    }
  }

  let rank = 1;
  const leaderboardLines = [];
  for (const group of groups) {
    if (leaderboardLines.length >= 10) break;
    const avgStr = group.roundedAvg !== null ? group.roundedAvg.toFixed(2) : '—';
    leaderboardLines.push(`${rank}. ${group.names.join(', ')} — ${group.completed} completed, ${avgStr} avg`);
    rank += group.names.length;
  }

  embed.addFields({ name: 'Full Leaderboard', value: leaderboardLines.join('\n') || 'No data' });

  return embed;
}

function buildMonthlyWrap(date = new Date()) {
  const prefix = date.toISOString().slice(0, 7);
  const label = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  return buildWrapEmbed(prefix, label);
}

function buildYearlyWrap(date = new Date()) {
  const prefix = date.toISOString().slice(0, 4);
  return buildWrapEmbed(prefix, prefix);
}

module.exports = { buildMonthlyWrap, buildYearlyWrap, statsForPrefix };
