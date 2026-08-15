// Embed helpers. v4 used discord.js EmbedBuilder; the Worker builds the same
// embeds as plain JSON (what the builder produced under the hood).

export const COLORS = {
  green:    0x2ecc71,
  blue:     0x3498db,
  purple:   0x9b59b6,
  gold:     0xf1c40f,
  orange:   0xe67e22,
  teal:     0x1abc9c,
  cyan:     0x00d4ff,
  indigo:   0x5865f2,
  darkBlue: 0x1a237e,
  grey:     0x95a5a6,
  red:      0xe74c3c,
};

// Position color map — QB/RB/WR/TE only. No K or DEF entries.
const POSITION_COLORS = {
  QB: COLORS.red,
  RB: COLORS.green,
  WR: COLORS.blue,
  TE: 0xf39c12, // yellow/amber
};

export function positionColor(position) {
  return POSITION_COLORS[position?.toUpperCase()] ?? COLORS.grey;
}

/**
 * Creates a consistent embed object.
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {number|string} opts.color  — use COLORS.xxx or a hex number
 * @param {Array<{name:string, value:string, inline?:boolean}>} [opts.fields]
 * @param {string} [opts.footer]
 * @param {string} [opts.url]
 * @param {string} [opts.thumbnail]
 */
export function createEmbed({ title, description, color, fields, footer, url, thumbnail } = {}) {
  const resolvedColor = typeof color === 'string' ? (COLORS[color] ?? COLORS.grey) : (color ?? COLORS.grey);

  const embed = {
    color: resolvedColor,
    timestamp: new Date().toISOString(),
    footer: { text: footer ? `Fleaflicker Dynasty Bot • ${footer}` : 'Fleaflicker Dynasty Bot' },
  };

  if (title) embed.title = title;
  if (description) embed.description = description;
  if (url) embed.url = url;
  if (thumbnail) embed.thumbnail = { url: thumbnail };

  if (fields && fields.length > 0) {
    embed.fields = fields.map((f) => ({
      name: f.name,
      value: f.value || '​',
      inline: f.inline ?? false,
    }));
  }

  return embed;
}

export function errorEmbed(message) {
  return createEmbed({
    title: '❌ Error',
    description: message || 'An unexpected error occurred. Please try again.',
    color: COLORS.red,
  });
}

/**
 * Truncate a string to maxLength, appending ellipsis if cut.
 */
export function truncate(str, maxLength = 4096) {
  if (!str || str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}

/**
 * Format a Unix timestamp (seconds) to a human-readable date string.
 */
export function formatTimestamp(epochSeconds) {
  if (!epochSeconds) return 'Unknown';
  return new Date(Number(epochSeconds) * 1000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  });
}
