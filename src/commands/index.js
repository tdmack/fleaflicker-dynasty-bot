// Registry of all slash commands. Each module exports { definition, execute }.

import * as activity from './activity.js';
import * as draftalerts from './draftalerts.js';
import * as draftboard from './draftboard.js';
import * as freeagents from './freeagents.js';
import * as matchup from './matchup.js';
import * as picks from './picks.js';
import * as player from './player.js';
import * as register from './register.js';
import * as roster from './roster.js';
import * as rules from './rules.js';
import * as score from './score.js';
import * as standings from './standings.js';
import * as testalert from './testalert.js';
import * as testweekly from './testweekly.js';
import * as trades from './trades.js';
import * as transactions from './transactions.js';
import * as value from './value.js';

const modules = [
  activity, draftalerts, draftboard, freeagents, matchup, picks, player,
  register, roster, rules, score, standings, testalert, testweekly, trades,
  transactions, value,
];

export const commands = Object.fromEntries(
  modules.map((m) => [m.definition.name, m]),
);

// Every command gets the shared `public` option (read centrally in
// src/index.js to pick the ephemeral flag) — appended here so a new command
// can't forget to declare it.
const PUBLIC_OPTION = {
  type: 5,
  name: 'public',
  description: 'Post this result publicly to the channel',
  required: false,
};

export const definitions = modules.map((m) => ({
  ...m.definition,
  options: [
    ...(m.definition.options || []).filter((o) => o.name !== 'public'),
    PUBLIC_OPTION,
  ],
}));
