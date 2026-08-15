// DraftMonitor — a single Durable Object (one per league) that polls the
// Fleaflicker draft board every POLL_MS while armed and posts:
//   - each new pick as it's made,
//   - "on the clock" alerts to the draft channel (@mention if registered),
//   - a DM to the on-the-clock manager (free mobile push),
//   - one reminder DM if the same manager is still up after reminderMinutes.
//
// Cron triggers bottom out at 1 minute — too coarse for a live draft clock —
// so the DO self-schedules sub-minute alarms instead. The 15-min trade cron
// doubles as a supervisor (ensureDraftMonitorAlarm) to heal a dead alarm
// chain. Armed manually via /draftalerts when a draft opens (next: 2027);
// disarms itself when the board fills or after IDLE_DISARM_MS without a
// board change (a stalled/paused draft), so steady-state cost is zero.
//
// The Fleaflicker API exposes no pick deadline, so the reminder timer runs
// from when THIS poller first saw the turn start — accurate to one poll.

import { DurableObject } from 'cloudflare:workers';
import { fetchLeagueDraftBoard } from '../services/fleaflicker.js';
import { parseDraftBoard, pickLabel } from '../lib/draftBoard.js';
import { postChannelMessage, sendDirectMessage, isDmBlockedError } from '../lib/discord.js';
import { getRegistrations } from '../lib/registrations.js';
import { createEmbed, truncate, COLORS } from '../utils/formatters.js';

const POLL_MS = 20 * 1000;
const IDLE_DISARM_MS = 48 * 3600 * 1000;
const DEFAULT_REMINDER_MINUTES = 30;
const MAX_PICKS_PER_UPDATE = 10;

// NOTE: stub helpers (getDraftMonitor / ensureDraftMonitorAlarm) live in
// src/lib/draftMonitorClient.js so command modules never import this file —
// the 'cloudflare:workers' import above is fatal to local Node scripts.

export class DraftMonitor extends DurableObject {
  async start(options = {}) {
    const now = Date.now();
    // Idempotent re-arm: /draftalerts on while already armed must not reset
    // the on-the-clock state (that would re-announce and re-DM the current
    // turn) — just apply the new reminder setting and heal the alarm.
    if (await this.ctx.storage.get('enabled')) {
      if (options.reminderMinutes) {
        await this.ctx.storage.put('reminderMinutes', options.reminderMinutes);
      }
      await this.ensureAlarm();
      return this.status();
    }
    await this.ctx.storage.put({
      enabled: true,
      armedAt: now,
      lastChangeAt: now,
      reminderMinutes: options.reminderMinutes || DEFAULT_REMINDER_MINUTES,
      // seeded=false: the first poll records already-made picks without
      // announcing them (same first-run pattern as the trade-alert cron).
      seeded: false,
      lastAnnouncedOverall: 0,
      lastPickKey: null,
      lastPickDesc: null,
      turnStartedAt: null,
      reminded: false,
    });
    await this.ctx.storage.setAlarm(now + 1000);
    return this.status();
  }

  async stop() {
    await this.ctx.storage.put('enabled', false);
    await this.ctx.storage.deleteAlarm();
    return this.status();
  }

  async status() {
    const s = await this.ctx.storage.get([
      'enabled', 'armedAt', 'lastChangeAt', 'lastPickDesc', 'reminderMinutes',
    ]);
    return {
      enabled: s.get('enabled') === true,
      armedAt: s.get('armedAt') ?? null,
      lastChangeAt: s.get('lastChangeAt') ?? null,
      lastPickDesc: s.get('lastPickDesc') ?? null,
      reminderMinutes: s.get('reminderMinutes') ?? DEFAULT_REMINDER_MINUTES,
    };
  }

  async ensureAlarm() {
    if (!(await this.ctx.storage.get('enabled'))) return false;
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
    return true;
  }

  async alarm() {
    if (!(await this.ctx.storage.get('enabled'))) return;
    try {
      await this.poll();
    } catch (err) {
      // Fleaflicker hiccup or Discord failure: log and keep the chain alive;
      // the idle timeout is the backstop if the outage never ends.
      console.error('[DraftMonitor] poll failed:', err.message);
    }
    if (await this.ctx.storage.get('enabled')) {
      await this.ctx.storage.setAlarm(Date.now() + POLL_MS);
    }
  }

  async poll() {
    const env = this.env;
    const channelId = env.DISCORD_DRAFT_CHANNEL_ID || env.DISCORD_TRADE_CHANNEL_ID;
    const now = Date.now();
    const s = await this.ctx.storage.get([
      'seeded', 'lastAnnouncedOverall', 'lastPickKey', 'turnStartedAt',
      'reminded', 'reminderMinutes', 'lastChangeAt',
    ]);

    const board = parseDraftBoard(await fetchLeagueDraftBoard(env));

    let lastAnnounced = s.get('lastAnnouncedOverall') || 0;
    if (!s.get('seeded')) {
      lastAnnounced = board.picksMade.reduce((m, p) => Math.max(m, p.overall || 0), 0);
      await this.ctx.storage.put({ seeded: true, lastAnnouncedOverall: lastAnnounced });
      console.log(`[DraftMonitor] Armed; seeded ${board.picksMade.length} existing picks (shape: ${board.shape})`);
    }

    const newPicks = board.picksMade.filter((p) => (p.overall || 0) > lastAnnounced);
    const lines = newPicks.slice(0, MAX_PICKS_PER_UPDATE).map(
      (p) => `✅ **${pickLabel(p)}** — ${p.teamName} select **${p.playerName}**`,
    );
    if (newPicks.length > MAX_PICKS_PER_UPDATE) {
      lines.push(`…and ${newPicks.length - MAX_PICKS_PER_UPDATE} more picks`);
    }

    if (board.complete === true) {
      if (channelId) {
        lines.push('', '🏁 **That\'s a wrap — the draft is complete!**');
        await this.postUpdate(channelId, lines);
      }
      await this.ctx.storage.put('enabled', false);
      console.log('[DraftMonitor] Draft complete — disarmed');
      return;
    }

    // On-the-clock change (only detectable in the rows shape)
    const current = board.currentPick;
    const pickKey = current ? `${current.teamId}:${current.overall}` : null;
    const prevKey = s.get('lastPickKey') ?? null;
    let changed = newPicks.length > 0;

    const otcChanged = Boolean(pickKey && pickKey !== prevKey);
    let reg = null;
    if (otcChanged) {
      changed = true;
      reg = (await getRegistrations(env))[current.teamId];
      const mention = reg ? ` <@${reg.userId}>` : '';
      lines.push(`🟢 **On the clock:** ${current.teamName}${mention} — pick ${pickLabel(current)}`);
      if (board.nextPick) lines.push(`⏭️ On deck: ${board.nextPick.teamName}`);
    }

    // The channel post must never gate the DM (the DM is the feature): a
    // failed post is logged, pick announcements retry next tick (their
    // watermark below only advances on success), and the DM still goes out.
    let posted = true;
    if (lines.length > 0 && channelId) {
      try {
        await this.postUpdate(channelId, lines);
      } catch (err) {
        posted = false;
        console.error('[DraftMonitor] Channel post failed:', err.message);
      }
    }

    if (otcChanged) {
      await this.ctx.storage.put({
        lastPickKey: pickKey,
        lastPickDesc: `${current.teamName} (pick ${pickLabel(current)})`,
        turnStartedAt: now,
        reminded: false,
      });
      if (reg) {
        await this.tryDm(reg.userId,
          `🟢 **You're on the clock!** ${current.teamName} is up — pick ${pickLabel(current)}.`
          + (board.nextPick ? ` On deck: ${board.nextPick.teamName}.` : '')
          + `\nMake your pick: ${leagueUrl(env)}`);
      }
    }

    // One reminder per turn if the same manager is still up
    if (pickKey && pickKey === prevKey && !s.get('reminded') && s.get('turnStartedAt')) {
      const reminderMs = (s.get('reminderMinutes') || DEFAULT_REMINDER_MINUTES) * 60 * 1000;
      if (now - s.get('turnStartedAt') >= reminderMs) {
        const reg = (await getRegistrations(env))[current.teamId];
        if (reg) {
          await this.tryDm(reg.userId,
            `⏰ **Reminder:** you're still on the clock — pick ${pickLabel(current)}.\n${leagueUrl(env)}`);
        } else if (channelId) {
          await this.postUpdate(channelId, [
            `⏰ **${current.teamName}** is still on the clock (pick ${pickLabel(current)}).`,
          ]);
        }
        await this.ctx.storage.put('reminded', true);
      }
    }

    if (changed) {
      // lastChangeAt always advances (idle detection tracks the BOARD, not
      // Discord); the announcement watermark only advances when the post
      // landed, so unannounced picks retry next tick.
      await this.ctx.storage.put('lastChangeAt', now);
      if (posted && newPicks.length > 0) {
        const maxOverall = newPicks.reduce((m, p) => Math.max(m, p.overall || 0), lastAnnounced);
        await this.ctx.storage.put('lastAnnouncedOverall', maxOverall);
      }
    } else if (now - (s.get('lastChangeAt') || now) >= IDLE_DISARM_MS) {
      if (channelId) {
        await this.postUpdate(channelId, [
          '💤 No draft activity for 48 hours — draft alerts disarmed. Re-arm with `/draftalerts action:on`.',
        ]);
      }
      await this.ctx.storage.put('enabled', false);
      console.log('[DraftMonitor] Idle timeout — disarmed');
    }
  }

  async postUpdate(channelId, lines) {
    await postChannelMessage(this.env, channelId, {
      embeds: [createEmbed({
        title: '📋 Draft Update',
        description: truncate(lines.join('\n'), 4000),
        color: COLORS.teal,
        footer: 'Draft alerts • /register to get DM\'d on your turn',
      })],
    });
  }

  async tryDm(userId, content) {
    try {
      await sendDirectMessage(this.env, userId, { content });
    } catch (err) {
      // Blocked DMs aren't an error worth retrying — the channel @mention
      // already reached them.
      const level = isDmBlockedError(err) ? 'log' : 'error';
      console[level](`[DraftMonitor] DM to ${userId} failed:`, err.message);
    }
  }
}

function leagueUrl(env) {
  return `https://www.fleaflicker.com/nfl/leagues/${env.FLEAFLICKER_LEAGUE_ID}`;
}
