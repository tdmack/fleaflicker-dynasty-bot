// Fleaflicker team -> Discord user mapping, self-service via /register.
// Stored as a single KV object: { [teamId]: { userId, teamName, registeredAt } }.
// Small league (~12 entries), so one key read/write per operation is fine.

const KV_KEY = 'draft:registrations:v1';

export async function getRegistrations(env) {
  return (await env.BOT_KV.get(KV_KEY, 'json')) || {};
}

export async function saveRegistrations(env, registrations) {
  await env.BOT_KV.put(KV_KEY, JSON.stringify(registrations));
}
