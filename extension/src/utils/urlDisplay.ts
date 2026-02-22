import { getNormalizedHostname } from './urlNormalization';

/**
 * Formats a URL for display by removing the protocol (http://, https://) and trailing slashes
 * @param url - The full URL to format
 * @returns The URL without the protocol prefix and trailing slashes
 */
export function formatUrlForDisplay(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/**
 * Gets the favicon URL for a given URL using Google's favicon service
 * @param url - The URL to get the favicon for
 * @returns The Google favicon service URL
 */
export function getFaviconUrl(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${getNormalizedHostname(url)}&sz=32`;
}

/**
 * The fallback SVG to use when a favicon fails to load
 */
export const FAVICON_FALLBACK = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%23666"/></svg>';
