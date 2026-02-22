/**
 * Formats time in seconds to a human-readable string with smart formatting:
 * - If hours == 0 and minutes < 10: m:ss (e.g., "5:23")
 * - If hours == 0 and minutes >= 10: mm:ss (e.g., "15:23")
 * - If 0 < hours < 10: h:mm:ss (e.g., "2:15:23")
 * - If hours >= 10: hh:mm:ss (e.g., "12:05:23")
 *
 * @param seconds - Total seconds to format
 * @returns Formatted time string
 */
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h === 0) {
    // No hours: format as m:ss or mm:ss
    if (m < 10) {
      // m:ss (no leading zero on minutes)
      return `${m}:${s.toString().padStart(2, '0')}`;
    } else {
      // mm:ss
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
  } else {
    // Has hours
    if (h < 10) {
      // h:mm:ss (no leading zero on hours)
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    } else {
      // hh:mm:ss
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
  }
}
