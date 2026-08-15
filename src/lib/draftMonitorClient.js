// Stub helpers for talking to the DraftMonitor Durable Object.
//
// Deliberately separate from src/do/draftMonitor.js: that module imports
// 'cloudflare:workers', which only resolves inside the Workers runtime.
// These helpers are plain binding lookups, and they're (transitively)
// imported by src/commands/index.js — which deploy-commands.js loads in
// local Node, where a 'cloudflare:' import is a fatal
// ERR_UNSUPPORTED_ESM_URL_SCHEME.

export function getDraftMonitor(env) {
  const id = env.DRAFT_MONITOR.idFromName(`league:${env.FLEAFLICKER_LEAGUE_ID}`);
  return env.DRAFT_MONITOR.get(id);
}

/** Called from the 15-min cron: restart the alarm chain if it died mid-draft. */
export async function ensureDraftMonitorAlarm(env) {
  try {
    await getDraftMonitor(env).ensureAlarm();
  } catch (err) {
    console.error('[DraftMonitor] ensureAlarm failed:', err.message);
  }
}
