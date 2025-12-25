/**
 * Normalizes a URL by stripping common subdomains (www., m., mobile.)
 * to allow grouping of related URLs.
 *
 * Examples:
 * - https://m.youtube.com/watch -> https://youtube.com/watch
 * - https://www.instagram.com -> https://instagram.com
 * - https://mobile.twitter.com -> https://twitter.com
 */
export function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname;

    // Strip common mobile/www prefixes
    const prefixesToStrip = ['www.', 'm.', 'mobile.'];

    for (const prefix of prefixesToStrip) {
      if (hostname.startsWith(prefix)) {
        hostname = hostname.substring(prefix.length);
        break; // Only strip one prefix
      }
    }

    // Reconstruct the URL with normalized hostname
    urlObj.hostname = hostname;
    return urlObj.href;
  } catch {
    // If URL parsing fails, return original
    return url;
  }
}

/**
 * Extracts and normalizes the hostname from a URL
 * Useful for display purposes
 */
export function getNormalizedHostname(url: string): string {
  try {
    const normalizedUrl = normalizeUrl(url);
    return new URL(normalizedUrl).hostname;
  } catch {
    return url;
  }
}

/**
 * Normalizes a hostname by stripping common prefixes
 * Useful when you already have a hostname (not a full URL)
 */
export function normalizeHostname(hostname: string): string {
  const prefixesToStrip = ['www.', 'm.', 'mobile.'];

  for (const prefix of prefixesToStrip) {
    if (hostname.startsWith(prefix)) {
      return hostname.substring(prefix.length);
    }
  }

  return hostname;
}
