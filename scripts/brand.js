// Sets the Discord application's avatar and About Me description. Run locally:
//   npm run brand        (reads .env via Node's --env-file)
// Uploads assets/icon.png (replace it with your own art if you like — PNG,
// 512x512 or larger) and a generic description. Run once after creating the
// app; re-run any time you change the icon or description.

import { readFileSync } from 'node:fs';

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error('Missing required environment variable: DISCORD_TOKEN');
  process.exit(1);
}

// This is your bot's About Me text — edit it freely. The repo link is here as
// attribution for the upstream template, not a requirement; drop it, or point
// it at your own fork, whatever suits your league.
const DESCRIPTION = [
  'Dynasty league assistant for Fleaflicker — live scores, standings,',
  'rosters, trade and waiver alerts, weekly recaps, and draft-turn DMs.',
  'Self-hosted on Cloudflare Workers:',
  'https://github.com/tdmack/fleaflicker-dynasty-bot',
].join(' ');

const payload = { description: DESCRIPTION };

try {
  const png = readFileSync(new URL('../assets/icon.png', import.meta.url));
  payload.icon = `data:image/png;base64,${png.toString('base64')}`;
} catch {
  console.warn('assets/icon.png not found — setting description only.');
}

console.log('Updating application description' + (payload.icon ? ' and icon' : '') + '...');

const res = await fetch('https://discord.com/api/v10/applications/@me', {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bot ${token}`,
  },
  body: JSON.stringify(payload),
});

if (!res.ok) {
  console.error(`Failed to update application: HTTP ${res.status}`, await res.text());
  process.exit(1);
}

const app = await res.json();
console.log(`Branding applied to "${app.name}". The avatar can take a minute to refresh in Discord.`);
