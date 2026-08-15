// Registration diagnostics. Run with: node --env-file=.env scripts/diagnose.js
// Prints which application the token belongs to and whether the bot is in the
// target guild — the two causes of "Missing Access" during command registration.

const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;

// The permission set the README's OAuth2 instructions ask for. Keep the two in
// sync — a mismatch is how people end up with a bot that can't post.
//   VIEW_CHANNEL 1024 + SEND_MESSAGES 2048 + EMBED_LINKS 16384
//   + READ_MESSAGE_HISTORY 65536 = 84992
const INVITE_PERMISSIONS = 84992;

if (!token || !appId || !guildId) {
  console.error('Missing DISCORD_TOKEN, DISCORD_APPLICATION_ID, or DISCORD_GUILD_ID in .env');
  process.exit(1);
}

const api = (path) => fetch(`https://discord.com/api/v10${path}`, {
  headers: { Authorization: `Bot ${token}` },
});

const me = await api('/oauth2/applications/@me');
if (!me.ok) {
  console.error(`Token check failed: HTTP ${me.status} — the token is invalid or was reset.`);
  process.exit(1);
}
const app = await me.json();
console.log(`Token belongs to application: "${app.name}" (ID ${app.id})`);
if (app.id !== appId) {
  console.error(`MISMATCH: .env DISCORD_APPLICATION_ID is ${appId} but the token belongs to ${app.id}.`);
  console.error('Fix: make the token and application ID come from the SAME app in the Developer Portal.');
  process.exit(1);
}
console.log('Token and application ID match. ✔');

const guilds = await api('/users/@me/guilds');
if (!guilds.ok) {
  console.error(`Could not list the bot's servers: HTTP ${guilds.status}`);
  process.exit(1);
}
const list = await guilds.json();
const inGuild = list.find((g) => g.id === guildId);
if (!inGuild) {
  console.error(`NOT IN SERVER: this bot is not a member of guild ${guildId}.`);
  console.error(`It is in: ${list.map((g) => `"${g.name}" (${g.id})`).join(', ') || '(no servers)'}`);
  console.error('Fix: open the invite link for THIS app and authorize it into your league server:');
  console.error(`https://discord.com/api/oauth2/authorize?client_id=${appId}&scope=bot%20applications.commands&permissions=${INVITE_PERMISSIONS}`);
  process.exit(1);
}
console.log(`Bot is a member of "${inGuild.name}" (${guildId}). ✔`);
console.log('All checks passed — npm run register should work now.');
