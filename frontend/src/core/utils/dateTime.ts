/**
 * Academic Timezone & Deadline Utilities
 * 
 * Central University FYIMP Academic Portal operates strictly on Asia/Kolkata
 * (Indian Standard Time, IST = UTC+05:30) with no daylight saving time (DST).
 * 
 * These utilities ensure:
 * 1. All deadline inputs in HTML5 <input type="datetime-local"> display and accept
 *    Asia/Kolkata wall-clock time, regardless of client/browser timezone.
 * 2. Conversions to/from UTC instant for database persistence are 100% deterministic
 *    and immune to browser-local timezone offsets or midnight shifts (F58).
 */

export const ASIA_KOLKATA_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // +05:30 in ms (19,800,000 ms)
export const ACADEMIC_TIMEZONE = 'Asia/Kolkata';

/**
 * Converts a UTC ISO string (or Date) to a 'YYYY-MM-DDTHH:mm' string in Asia/Kolkata time,
 * suitable for feeding directly into <input type="datetime-local">.
 */
export function utcIsoToKolkataInput(utcIso: string | Date | null | undefined): string {
  if (!utcIso) return '';
  const d = typeof utcIso === 'string' ? new Date(utcIso) : utcIso;
  if (isNaN(d.getTime())) return '';

  // Shift epoch by India offset, then extract UTC parts (which represent India wall-clock)
  const kolkataEpoch = d.getTime() + ASIA_KOLKATA_OFFSET_MS;
  const kolkataDate = new Date(kolkataEpoch);

  const year = kolkataDate.getUTCFullYear();
  const month = String(kolkataDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kolkataDate.getUTCDate()).padStart(2, '0');
  const hours = String(kolkataDate.getUTCHours()).padStart(2, '0');
  const minutes = String(kolkataDate.getUTCMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Converts a 'YYYY-MM-DDTHH:mm' (or with seconds) Asia/Kolkata wall-clock input string
 * into an absolute UTC ISO string ('...Z') for API transmission and database persistence.
 * 
 * Does NOT rely on browser-local new Date(str) parsing.
 */
export function kolkataInputToUtcIso(kolkataDateTime: string | null | undefined): string {
  if (!kolkataDateTime || typeof kolkataDateTime !== 'string') return '';
  const trimmed = kolkataDateTime.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  
  if (!match) {
    // Fallback: if already a full ISO string with Z or offset, try Date parse
    const fallback = new Date(trimmed);
    if (!isNaN(fallback.getTime())) {
      return fallback.toISOString();
    }
    return '';
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const hours = parseInt(match[4], 10);
  const minutes = parseInt(match[5], 10);
  const seconds = match[6] ? parseInt(match[6], 10) : 0;

  // Compute UTC milliseconds representing this wall-clock time
  const wallClockUtcMs = Date.UTC(year, month, day, hours, minutes, seconds);
  
  // Subtract India offset to obtain true UTC instant
  const trueUtcMs = wallClockUtcMs - ASIA_KOLKATA_OFFSET_MS;
  return new Date(trueUtcMs).toISOString();
}

/**
 * Formats a UTC ISO timestamp for user display with explicit IST designation.
 * e.g., "15 Oct 2026, 05:00 PM IST"
 */
export function formatKolkataDisplay(utcIso: string | Date | null | undefined): string {
  if (!utcIso) return 'Not set';
  const d = typeof utcIso === 'string' ? new Date(utcIso) : utcIso;
  if (isNaN(d.getTime())) return 'Invalid date';

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: ACADEMIC_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d) + ' IST';
}

/**
 * Checks whether the current time is strictly before the given UTC deadline instant.
 */
export function isRegistrationWindowOpen(deadlineUtcIso: string | null | undefined, now = new Date()): boolean {
  if (!deadlineUtcIso) return false;
  const deadline = new Date(deadlineUtcIso);
  if (isNaN(deadline.getTime())) return false;
  return now.getTime() < deadline.getTime();
}
