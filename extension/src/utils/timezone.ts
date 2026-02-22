/**
 * Gets the short timezone abbreviation for a given timezone and date.
 * Examples: "EST", "PDT", "JST", "GMT", etc.
 *
 * @param timezoneName - IANA timezone name (e.g., "America/New_York")
 * @param date - Optional date to get abbreviation for (defaults to now)
 * @returns Timezone abbreviation (e.g., "EST")
 */
export function getTimezoneAbbreviation(timezoneName?: string, date: Date = new Date()): string {
  try {
    const tz = timezoneName || Intl.DateTimeFormat().resolvedOptions().timeZone;

    // Use Intl.DateTimeFormat to get the short timezone name
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short'
    });

    const parts = formatter.formatToParts(date);
    const timeZonePart = parts.find(part => part.type === 'timeZoneName');

    return timeZonePart?.value || tz;
  } catch (error) {
    console.error('Error getting timezone abbreviation:', error);
    return timezoneName || 'Local';
  }
}

/**
 * Gets both the full timezone name and its abbreviation.
 *
 * @param date - Optional date to get abbreviation for (defaults to now)
 * @returns Object with full name and abbreviation
 */
export function getTimezoneInfo(date: Date = new Date()): { name: string; abbreviation: string } {
  const name = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const abbreviation = getTimezoneAbbreviation(name, date);

  return { name, abbreviation };
}

/**
 * Formats a date with timezone abbreviation.
 * Example: "2/21/2026, 3:00:00 AM EST"
 *
 * @param date - Date to format
 * @param timezoneName - Optional timezone name
 * @returns Formatted date string with timezone abbreviation
 */
export function formatDateWithTimezone(date: Date, timezoneName?: string): string {
  const tz = timezoneName || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const abbreviation = getTimezoneAbbreviation(tz, date);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: true
  });

  return `${formatter.format(date)} ${abbreviation}`;
}
