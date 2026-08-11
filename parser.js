// parser.js
//
// Confirmed real format (from /debug-last-wordle-message output) of Discord's
// built-in Wordle activity's daily summary message:
//
//   **Your group is on a 2 day streak!** 🔥 Here are yesterday's results:
//   👑 3/6: <@1456505906023104527>
//   4/6: <@1394744321592524830> <@916772908725059584>
//   5/6: <@1050885959295701003> <@699305528823644252>
//
// One line per score, each line listing every user (as raw <@id> mentions)
// who got that score. Returns { userId, tries }[] — resolving the Discord
// user ID to an actual display name happens in index.js, since that needs
// a guild member lookup which this module doesn't have access to.

function parseScoreLines(text) {
  const results = [];
  const lines = (text || '').split('\n');

  for (const line of lines) {
    // Matches "3/6:", "👑 3/6:", "X/6:" etc. at the start of a line's score portion
    const match = line.match(/(?:^|\s)([1-6]|X)\/6:\s*(.+)$/i);
    if (!match) continue;

    const scoreRaw = match[1].toUpperCase();
    const tries = scoreRaw === 'X' ? 7 : parseInt(scoreRaw, 10);

    const mentions = [...match[2].matchAll(/<@!?(\d+)>/g)];
    for (const mention of mentions) {
      results.push({ userId: mention[1], tries });
    }
  }

  return results;
}

/**
 * Extracts { userId, tries }[] from a Discord message that might be the
 * official Wordle activity's daily results summary. Returns [] for
 * messages that don't match (e.g. "so-and-so is playing" notices).
 */
function parseWordleMessage(message) {
  const collected = [];

  if (message.content) {
    collected.push(...parseScoreLines(message.content));
  }

  // Kept as a fallback in case the format ever changes to use embeds instead.
  for (const embed of message.embeds || []) {
    if (embed.description) collected.push(...parseScoreLines(embed.description));
    for (const field of embed.fields || []) {
      collected.push(...parseScoreLines(`${field.name}\n${field.value}`));
    }
  }

  return collected;
}

/**
 * Heuristic check for whether a message is likely from Discord's built-in
 * Wordle activity (as opposed to a random human message).
 */
function isLikelyWordleActivityMessage(message) {
  // Never match the bot's own messages, even if its name contains "wordle".
  if (message.client?.user && message.author?.id === message.client.user.id) return false;

  const authorName = (message.author?.username || '').toLowerCase();
  if (authorName.includes('wordle')) return true;
  if (message.embeds?.some(e => (e.title || '').toLowerCase().includes('wordle'))) return true;
  return false;
}

module.exports = { parseWordleMessage, isLikelyWordleActivityMessage };
