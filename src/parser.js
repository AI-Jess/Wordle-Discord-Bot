// parser.js — reads the daily summary that Discord's built-in Wordle
// activity posts. Confirmed format:
//
//   **Your group is on a 2 day streak!** 🔥 Here are yesterday's results:
//   👑 3/6: <@1456505906023104527>
//   4/6: <@1394744321592524830> <@916772908725059584>
//
// Works on raw Discord API message JSON (no discord.js needed).

function parseScoreLines(text) {
  const results = [];
  for (const line of (text || '').split('\n')) {
    const match = line.match(/(?:^|\s)([1-6]|X)\/6:\s*(.+)$/i);
    if (!match) continue;
    const raw = match[1].toUpperCase();
    const tries = raw === 'X' ? 7 : parseInt(raw, 10);
    for (const m of match[2].matchAll(/<@!?(\d+)>/g)) results.push({ userId: m[1], tries });
  }
  return results;
}

function parseWordleMessage(message) {
  const out = [...parseScoreLines(message.content)];
  for (const embed of message.embeds || []) {
    if (embed.description) out.push(...parseScoreLines(embed.description));
    for (const f of embed.fields || []) out.push(...parseScoreLines(`${f.name}\n${f.value}`));
  }
  return out;
}

function isWordleMessage(message, botUserId) {
  if (botUserId && message.author?.id === botUserId) return false;
  const name = `${message.author?.username || ''} ${message.author?.global_name || ''}`.toLowerCase();
  if (name.includes('wordle')) return true;
  return (message.embeds || []).some(e => (e.title || '').toLowerCase().includes('wordle'));
}

module.exports = { parseScoreLines, parseWordleMessage, isWordleMessage };
