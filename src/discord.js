// discord.js — tiny wrapper over Discord's HTTP API. No always-on
// connection: every call is a one-off request made with the bot token.

const API = 'https://discord.com/api/v10';
const TOKEN = process.env.DISCORD_TOKEN;

async function call(method, route, body) {
  if (!TOKEN) throw new Error('DISCORD_TOKEN is not set. Add it as a repository secret.');
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + route, {
      method,
      headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (res.status === 429) { // rate limited: wait as told, then retry
      const wait = (await res.json().catch(() => ({}))).retry_after || 1;
      await new Promise(r => setTimeout(r, wait * 1000 + 250));
      continue;
    }
    if (!res.ok) throw new Error(`Discord ${method} ${route} failed: ${res.status} ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }
  throw new Error(`Discord ${method} ${route} kept rate limiting.`);
}

const me = () => call('GET', '/users/@me');
const channel = id => call('GET', `/channels/${id}`);
const messages = (channelId, before) =>
  call('GET', `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ''}`);
const member = (guildId, userId) => call('GET', `/guilds/${guildId}/members/${userId}`);
const user = userId => call('GET', `/users/${userId}`);
const send = (channelId, payload) => call('POST', `/channels/${channelId}/messages`, payload);

module.exports = { me, channel, messages, member, user, send };
