# Fleaflicker Dynasty Bot

A Discord bot for **dynasty NFL fantasy leagues on Fleaflicker** — the first
publicly available one. Runs entirely on a **free Cloudflare Workers account**:
no server to rent, no process to keep alive, nothing that sleeps. You deploy
your own copy, wired to your own league and Discord server, in about 15
minutes.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tdmack/fleaflicker-dynasty-bot)

---

## Commands

| Command | Description |
|---|---|
| `/freeagents [position]` | Top 10 free agents by season avg (QB/RB/WR/TE/FLEX) |
| `/score [team]` | Current week matchup scores |
| `/roster <team>` | Starting lineup for a team |
| `/standings` | Full league standings (W-L, PF, PA, streak) |
| `/picks <team>` | Future draft pick assets for a team |
| `/draftboard [season]` | Draft board — first 5 rounds |
| `/transactions [team]` | Last 10 waiver/add/drop transactions |
| `/activity` | League activity feed (last 10 items) |
| `/matchup <team>` | Full boxscore for a team's current matchup |
| `/rules [section]` | League scoring and roster rules |
| `/trades [filter]` | Recent completed or pending trades |
| `/player <name>` | Player card with status, injury, news |
| `/value [player]` | Dynasty trade values (FantasyCalc) |
| `/register <team>` | Link your Discord account to your Fleaflicker team (draft-turn DMs) |
| `/draftalerts <action>` | Arm/disarm draft-turn alerts (commissioner only) |

All replies are private (ephemeral) by default; add `public:True` to post to
the channel. `/testalert`, `/testweekly`, and `/draftalerts` require the
Manage Server permission.

## Automated posts (cron)

- **Trade alerts** — every 15 minutes the Worker polls Fleaflicker and posts
  new pending/executed trades to `DISCORD_TRADE_CHANNEL_ID`. When
  `TRADE_POLLS = "on"`, each completed trade alert is followed by a 48-hour
  "Who won this trade?" native Discord poll.
- **Transaction feed** — off by default. Set `TRANSACTION_FEED` to `waivers`
  (waiver claims only) or `all` (claims plus adds/drops) and new transactions
  are posted to the trade channel on the same 15-minute poll.
- **Week in Review** — checked daily, posted once per week *as soon as every
  matchup is final* (robust to Monday/Wednesday/holiday slates): final scores,
  standings, **all-play records & luck**, **coach ratings** (actual vs optimal
  lineup, points left on bench), top scorers, and the week's moves.
- **Week Preview** — posted once per week after the previous recap: matchups
  with projections. Posts go to `DISCORD_RECAP_CHANNEL_ID` (falls back to the
  trade channel). In the offseason nothing posts.
- **Players to Monitor** — Thursday and Sunday mornings (11am ET) during the
  season: every starting lineup is checked for injured starters
  (OUT/doubtful/questionable), starters on bye, and **empty starting slots**.
  Thursday catches TNF starters before their early lock. Posts to
  `DISCORD_RECAP_CHANNEL_ID` (falls back to the trade channel), and only when
  something needs attention.

The first run of each 15-minute poller (trade alerts, transaction feed) seeds
its "already seen" state without posting, so adopting the bot mid-season
doesn't spam your channel with backfill. The weekly job does not seed: on a
fresh install its first daily tick posts the most recent completed week's
recap.

## Draft-turn alerts

When a draft is live, a commissioner runs `/draftalerts action:on`. A Durable
Object then polls the draft board every 20 seconds and posts each pick,
announces who is **on the clock** (with an @mention), and **DMs the
on-the-clock manager** — Discord DMs trigger free mobile push notifications,
so no SMS is needed. A reminder DM goes out if the same manager is still up
after 30 minutes (configurable via `reminder_minutes`). Managers opt in with
`/register team:<name>`, which sends a test DM immediately so blocked-DM
privacy settings surface at signup, not on draft night. The monitor disarms
itself when the board fills or after 48 idle hours, so it costs nothing
between drafts. Updates post to `DISCORD_DRAFT_CHANNEL_ID` (falls back to the
trade channel).

---

## Setup

You need: Node.js 20.6+, a free
[Cloudflare account](https://dash.cloudflare.com/sign-up), a GitHub account,
and Manage Server permission on the Discord server you're deploying into.

### 1. Create the Discord application (do this first)

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. **Bot** tab → Reset/copy the Token → this is `DISCORD_TOKEN`
3. **OAuth2 → URL Generator**: scopes = `bot` + `applications.commands`;
   permissions: Send Messages, Embed Links → open the generated URL and
   authorize the bot into your server
4. **General Information** → copy the **Application ID**
   (`DISCORD_APPLICATION_ID`) and **Public Key** (`DISCORD_PUBLIC_KEY`)

Leave the Interactions Endpoint URL blank for now — you'll set it in step 5,
after the Worker exists.

### 2. Deploy your own copy

Click the **Deploy to Cloudflare** button at the top of this README. Cloudflare
creates a copy of this repo in your GitHub account, provisions the KV namespace
and the Durable Object on your free Cloudflare plan, and wires up
deploy-on-push, so every later commit to your copy redeploys automatically.

This first deploy will succeed but the bot won't do anything useful yet: the
`[vars]` checked into `wrangler.toml` are placeholders, and stay that way until
step 4.

Then clone your copy locally — the remaining steps edit files in it:

```bash
git clone https://github.com/<your-username>/fleaflicker-dynasty-bot.git
cd fleaflicker-dynasty-bot
npm install
```

### 3. Set the three secrets

Secrets are never stored in the repo. Either run:

```bash
npx wrangler secret put DISCORD_TOKEN
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APPLICATION_ID
```

If you haven't run `npx wrangler login` yet, the first `secret put` opens a
browser to authorize the Cloudflare CLI. Alternatively, add all three in the
Cloudflare dashboard under your Worker → **Settings → Variables** (as encrypted
secrets, not plaintext vars).

### 4. Fill in `[vars]` and push

Edit `wrangler.toml` and set at minimum `FLEAFLICKER_LEAGUE_ID`,
`DISCORD_GUILD_ID`, and `DISCORD_TRADE_CHANNEL_ID` — see
[Configuration reference](#configuration-reference) for every option. Then:

```bash
git commit -am "configure for my league"
git push
```

The push triggers a deploy. Note the Worker URL — it's on the Worker's page in
the Cloudflare dashboard, and looks like
`https://<worker-name>.<your-subdomain>.workers.dev`, where `<worker-name>` is
the `name` field in `wrangler.toml`.

### 5. Point Discord at the Worker

Developer Portal → your app → **General Information** → set **Interactions
Endpoint URL** to the Worker URL → Save. Discord sends a signed PING and the
save only succeeds if the deployed Worker verifies it — so the deploy in step 4
must have finished first.

### 6. Register the slash commands

```bash
cp .env.example .env   # fill in DISCORD_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID
npm run register
```

Commands register per-guild, so they appear instantly. Re-run this any time you
change command definitions.

### 7. Verify

In Discord, run `/standings` — if it returns your league's table, interactions
and the Fleaflicker config are both working. Then run `/testalert` (requires
Manage Server) to confirm the bot can actually post to
`DISCORD_TRADE_CHANNEL_ID`; that's the path every cron uses. If either fails,
see [Troubleshooting](#troubleshooting).

### Manual setup (no Deploy button)

If you'd rather not use the Deploy button (or want the Worker in an existing
Cloudflare account without the GitHub integration), do steps 1, 5, 6 and 7
above and replace steps 2–4 with:

```bash
git clone https://github.com/tdmack/fleaflicker-dynasty-bot.git
cd fleaflicker-dynasty-bot
npm install
npx wrangler login
npx wrangler kv namespace create BOT_KV
```

Copy the returned `id` into `wrangler.toml` under `[[kv_namespaces]]`, fill in
`[vars]`:

```toml
[vars]
FLEAFLICKER_LEAGUE_ID = "<your-league-id>"
FLEAFLICKER_SPORT = "NFL"
DISCORD_GUILD_ID = "<your-server-id>"
DISCORD_TRADE_CHANNEL_ID = "<your-trade-channel-id>"
```

set the three secrets as in step 3, and deploy:

```bash
npx wrangler deploy
```

The printed Worker URL is what goes in the Interactions Endpoint URL field.
Redeploy with `npx wrangler deploy` after any code or config change.

---

## Configuration reference

Set in `wrangler.toml` under `[vars]` (IDs come from Discord with Developer
Mode on: right-click → Copy ID):

| Var | Required | What it is |
|---|---|---|
| `FLEAFLICKER_LEAGUE_ID` | yes | The number in your league URL: `fleaflicker.com/nfl/leagues/<this>` |
| `FLEAFLICKER_SPORT` | no — defaults to `NFL` | `NFL` |
| `DISCORD_GUILD_ID` | yes | Your Discord server ID (commands register per-guild — instant) |
| `DISCORD_TRADE_CHANNEL_ID` | for crons | Channel for trade alerts + transaction feed |
| `DISCORD_RECAP_CHANNEL_ID` | no | Weekly recap/preview + Players to Monitor channel (falls back to trade channel) |
| `DISCORD_DRAFT_CHANNEL_ID` | no | Draft alert channel (falls back to trade channel) |
| `TRANSACTION_FEED` | no | `off` (default), `waivers`, or `all` — automated feed of claims/adds/drops |
| `TRADE_POLLS` | no | `on` posts a 48h "Who won this trade?" poll after each completed trade |
| `FANTASYCALC_NUM_QBS` | no | `/value` league shape; default `2` (superflex) |
| `FANTASYCALC_NUM_TEAMS` | no | default `12` |
| `FANTASYCALC_PPR` | no | default `0.5` |

Secrets (set with `npx wrangler secret put <NAME>`): `DISCORD_TOKEN`,
`DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`.

## League-type assumptions

Built for **dynasty** leagues with **QB/RB/WR/TE/FLEX** starting slots:

- Kickers and defenses never appear in any output or filter. If your league
  starts K or D/ST, this bot will ignore them everywhere.
- `/picks`, `/draftboard`, and draft-turn alerts assume rookie/startup drafts
  exist — in a redraft league they're just dead weight.
- `/value` uses FantasyCalc **dynasty** values, shaped by the
  `FANTASYCALC_*` vars above.
- `/rules` shows only QB/RB/WR/TE/FLEX starting slots (allowlist in
  `src/commands/rules.js`).

## Troubleshooting

- **Discord rejects the Interactions Endpoint URL** — the Worker must be
  deployed *first*, and `DISCORD_PUBLIC_KEY` must match the app's General
  Information page. Discord sends a signed PING on save; a 401 means the
  wrong public key.
- **Slash commands don't appear** — run `npm run register` (with `.env`
  filled in); confirm the bot was invited with the `applications.commands`
  scope and `DISCORD_GUILD_ID` is your server, then reload Discord (Ctrl+R).
- **Crons never post** — `DISCORD_TRADE_CHANNEL_ID` must be set and the bot
  needs Send Messages + Embed Links in that channel. First run only seeds
  (no posts) by design. Check Worker logs in the Cloudflare dashboard.
- **`/value` numbers look wrong for your league** — set the `FANTASYCALC_*`
  vars to your league's shape.

---

## Architecture notes

- **HTTP interactions, not a gateway** — Discord POSTs each slash command to
  the Worker; there is no always-on process. Every command is ACKed with a
  deferred response and resolved in the background (`ctx.waitUntil`), so the
  3-second interaction deadline never applies.
- **State lives in KV** (`BOT_KV`): team-name cache (1h staleness check),
  last-seen trade IDs, last-seen transaction-feed snapshots
  (`txfeed:seen:<mode>`), posted-week markers, team↔user draft registrations,
  cached DM channel ids. FantasyCalc dynasty values are also cached in KV,
  keyed per league shape (`FANTASYCALC_*` vars). Per-user command cooldowns
  are best-effort and live in isolate memory, not KV. Draft-monitor state
  lives in the `DraftMonitor` Durable Object's own storage.
- **Positions** — QB, RB, WR, TE, FLEX only. DEF and K never appear in any
  output, filter, or color map.
- **Error handling** — users see a red error embed, never a stack trace.
- **All-play / luck / coach rating semantics** are adapted from the Dynasty
  Command Center week-in-review design: luck = actual win% − all-play win%;
  coach rating = actual ÷ Fleaflicker's optimal lineup, shown as "—" (never
  a fake number) when the optimum is missing or zero.
- **Costs** — everything fits Cloudflare's free tier with large headroom
  (~100k requests/day allowed; a 12-team league uses a few hundred).

## File structure

```
├── wrangler.toml            # Worker config: crons, KV + DO bindings, vars
├── deploy-commands.js       # Local script: registers the slash commands
├── src/
│   ├── index.js             # fetch (interactions) + scheduled (crons) + DO export
│   ├── lib/                 # signature verify, Discord REST (incl. DMs),
│   │                        # option parsing, draft-board parsing, registrations
│   ├── services/            # fleaflicker.js, fantasycalc.js
│   ├── cache/teamCache.js   # team list in KV
│   ├── utils/               # embed formatters, trade formatting
│   ├── commands/            # slash command handlers
│   ├── jobs/                # tradeAlerts.js, transactionFeed.js, weekly.js,
│   │                        # playersToMonitor.js
│   └── do/draftMonitor.js   # DraftMonitor Durable Object (draft-turn alerts)
└── test/                    # node:test unit tests (npm test)
```

## Local development

```bash
npm test                            # unit tests (node:test, no network)
npx wrangler dev                    # local server (uses real KV bindings with --remote)
npx wrangler dev --test-scheduled   # then: curl "http://localhost:8787/__scheduled?cron=*%2F15+*+*+*+*"
npx wrangler tail                   # live logs from the deployed Worker
```

`npm test` relies on glob support in `node --test`, which needs Node 21+; the
bot itself only needs the documented Node 20.6+ floor.

## License

[MIT](LICENSE) — do what you like with it. Fork it, change it, run it for your
league.
