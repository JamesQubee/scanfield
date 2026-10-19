// Nicknames are shown on screen, so they must never carry contact details.
// The character set already rules out "@" and ".com"; the rest catches URLs and phone numbers.
const ALLOWED = /^[A-Za-z0-9 _-]{2,16}$/;

export function normalizeNickname(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const nickname = input.trim().replace(/\s+/g, " ");
  if (!ALLOWED.test(nickname)) return null;

  const lower = nickname.toLowerCase();
  if (lower.includes("www") || lower.includes("http")) return null;
  // "010 1234-5678" is still a phone number once the separators are gone.
  if (/\d{5,}/.test(nickname.replace(/[ _-]/g, ""))) return null;
  return nickname;
}
