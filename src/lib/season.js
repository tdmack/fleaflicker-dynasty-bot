// NFL calendar helpers. getMonth() is 0-based: 8 = September, 5 = June.

/** True once the NFL season has plausibly started (September onward). */
export function seasonHasStarted(date = new Date()) {
  return date.getMonth() >= 8;
}

/**
 * The NFL season year a date belongs to: July–December → that calendar year,
 * January–June → the previous one (a January week 17 is still last season).
 * Used only as a fallback when the API omits its season field.
 */
export function nflSeasonYear(date = new Date()) {
  return date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
}
