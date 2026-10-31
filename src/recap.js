// recap.js — builds the Discord embeds for weekly, monthly and yearly recaps.

const { summarize } = require('./stats');
const { short, weekday, MONTHS } = require('./time');

const GREEN = 0x6aaa64;
const f2 = n => n.toFixed(2);
const sc = t => (t === 7 ? 'X' : t) + '/6';
const join = names => [...new Set(names)].join(', ');
const cap = (s, n = 1000) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function leaderboard(s) {
  const lines = [];
  let rank = 0, lastAvg = null;
  s.ranked.slice(0, 15).forEach((p, i) => {
    if (p.avg.toFixed(2) !== lastAvg) rank = i + 1;
    lastAvg = p.avg.toFixed(2);
    const medal = ['🥇', '🥈', '🥉'][rank - 1] || `${rank}.`;
    lines.push(`${medal} **${p.name}** · ${f2(p.avg)} avg · ${p.games} played${p.fails ? ` · ${p.fails}× X` : ''}`);
  });
  if (s.unranked.length) {
    lines.push(`*Not enough games to rank:* ${s.unranked.map(p => `${p.name} (${p.games})`).join(', ')}`);
  }
  return lines.join('\n') || 'Nobody played. 😶';
}

function chokeField(s) {
  if (s.fails.length) {
    const who = {};
    for (const r of s.fails) (who[r.name] ||= []).push(r.d);
    const top = Object.entries(who).sort((a, b) => b[1].length - a[1].length);
    return { name: '💀 Choked', value: cap(top.map(([n, ds]) => `**${n}** went X/6 ${ds.length > 1 ? `${ds.length} times` : `on ${weekday(ds[0])} ${short(ds[0])}`}`).join('\n')) };
  }
  if (s.sixes.length) {
    const n = {};
    for (const r of s.sixes) n[r.name] = (n[r.name] || 0) + 1;
    const list = Object.entries(n).sort((a, b) => b[1] - a[1]).map(([name, k]) => `${name}${k > 1 ? ` ×${k}` : ''}`);
    return { name: '😅 Close calls', value: cap(`No fails. Scraped by on 6/6: ${list.join(', ')}`) };
  }
  return { name: '💀 Choked', value: 'Nobody. Clean sheet for everyone.' };
}

function extras(s, { streakLabel }) {
  const fields = [];
  if (s.best.length) {
    const label = s.best[0].tries === 1 ? '🤯 Hole in one' : '🎯 Best guess';
    fields.push({ name: label, value: cap(s.best.slice(0, 6).map(r => `**${r.name}** · ${sc(r.tries)} on ${weekday(r.d)} ${short(r.d)}`).join('\n')) });
  }
  fields.push(chokeField(s));
  if (s.improved) {
    fields.push({ name: '📈 Most improved', value: `**${s.improved.name}** · ${f2(s.improved.from)} → ${f2(s.improved.to)} avg` });
  }
  const streaks = s.streaks.filter(x => x[streakLabel.key] >= 3).sort((a, b) => b[streakLabel.key] - a[streakLabel.key]).slice(0, 5);
  if (streaks.length) {
    fields.push({ name: streakLabel.title, value: streaks.map(x => `**${x.name}** · ${x[streakLabel.key]} days`).join('\n') });
  }
  if (s.toughest) {
    fields.push({ name: '🧱 Toughest day', value: `${weekday(s.toughest.d)} ${short(s.toughest.d)} · group avg ${f2(s.toughest.avg)} across ${s.toughest.players} players` });
  }
  return fields;
}

function build(data, start, end, { title, minGames, streakLabel }) {
  const s = summarize(data, start, end, { minGames });
  if (!s.rows.length) {
    return { title, description: 'No results recorded for this stretch.', color: GREEN };
  }
  return {
    title,
    color: GREEN,
    description: `${s.rows.length} games from ${s.players.length} players · group avg ${f2(s.groupAvg)}`,
    fields: [{ name: '🏆 Leaderboard', value: cap(leaderboard(s)) }, ...extras(s, { streakLabel })],
    footer: { text: `X counts as 7 guesses. Ranked players need ${minGames}+ games.` }
  };
}

const weekly = (data, monday, sunday) => build(data, monday, sunday, {
  title: `🟩 Wordle Wrapped · ${short(monday)} – ${short(sunday)}`,
  minGames: 3,
  streakLabel: { key: 'n', title: '🔥 Active streaks' }
});

const monthly = (data, ym) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return build(data, `${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`, {
    title: `🟩 Wordle Wrap · ${MONTHS[m - 1]} ${y}`,
    minGames: 8,
    streakLabel: { key: 'longest', title: '🔥 Longest streaks this month' }
  });
};

const yearly = (data, y) => build(data, `${y}-01-01`, `${y}-12-31`, {
  title: `🟩 Wordle Wrap · ${y}`,
  minGames: 30,
  streakLabel: { key: 'longest', title: '🔥 Longest streaks this year' }
});

// Markdown version for previews in the GitHub run summary.
function toMarkdown(embed) {
  const parts = [`### ${embed.title}`, embed.description || ''];
  for (const fl of embed.fields || []) parts.push(`**${fl.name}**\n\n${fl.value}`);
  if (embed.footer) parts.push(`_${embed.footer.text}_`);
  return parts.join('\n\n');
}

module.exports = { weekly, monthly, yearly, toMarkdown };
