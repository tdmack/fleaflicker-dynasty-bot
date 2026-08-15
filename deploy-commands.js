// Registers all slash commands to the guild. Run locally with:
//   npm run register     (reads .env via Node's --env-file)
// Re-run any time command definitions change.

import { definitions } from './src/commands/index.js';

const token = process.env.DISCORD_TOKEN;
const applicationId = process.env.DISCORD_APPLICATION_ID || process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !applicationId || !guildId) {
  console.error('Missing required environment variables: DISCORD_TOKEN, DISCORD_APPLICATION_ID (or DISCORD_CLIENT_ID), DISCORD_GUILD_ID');
  process.exit(1);
}

const url = `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;

console.log(`Registering ${definitions.length} slash commands to guild ${guildId}...`);

const res = await fetch(url, {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bot ${token}`,
  },
  body: JSON.stringify(definitions),
});

if (!res.ok) {
  console.error(`Failed to register commands: HTTP ${res.status}`, await res.text());
  process.exit(1);
}

console.log('All slash commands registered successfully.');
