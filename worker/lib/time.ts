// Lemon Squeezy timestamps look like "2023-01-17T12:43:51.000000Z". We store every timestamp
// in exactly that shape (UTC, six fractional digits) so SQL can order them as plain text.
const ISO_UTC = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(?:Z|[+-]00:?00)$/;

export function lsTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace(/Z$/, "000Z");
}

export function canonicalLsTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ISO_UTC.exec(value);
  if (match) {
    const [, date, time, fraction = ""] = match;
    if (Number.isNaN(Date.parse(`${date}T${time}Z`))) return null;
    return `${date}T${time}.${fraction.padEnd(6, "0").slice(0, 6)}Z`;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : lsTimestamp(ms);
}

export function parseLsTimestamp(value: string | null): number | null {
  const canonical = canonicalLsTimestamp(value);
  return canonical === null ? null : Date.parse(`${canonical.slice(0, 23)}Z`);
}

// The API hands the browser plain millisecond ISO strings, which every engine parses.
export function toApiTimestamp(value: string | null): string | null {
  const ms = parseLsTimestamp(value);
  return ms === null ? null : new Date(ms).toISOString();
}
