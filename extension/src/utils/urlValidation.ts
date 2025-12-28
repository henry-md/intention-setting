/**
 * Shared URL validation and preparation utilities.
 * Used by Home.tsx and GroupEdit.tsx to avoid duplication.
 */

/**
 * Validate if a string is a properly formatted URL
 */
export function isValidUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    // Check that the hostname contains at least one dot (e.g., youtube.com, not just youtube)
    return urlObj.hostname.includes('.');
  } catch {
    return false;
  }
}

/**
 * Prepare a URL input for storage:
 * - Adds .com if no domain extension
 * - Adds https:// if no protocol
 * - Validates the URL
 * Returns the prepared URL or throws an error
 */
export function prepareUrl(input: string): string {
  let url = input.trim();

  if (!url) {
    throw new Error('Please enter a URL');
  }

  // If no domain extension is provided, add .com
  if (!url.includes('.')) {
    url = url + '.com';
  }

  // Automatically prepend https:// if no protocol is specified
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  if (!isValidUrl(url)) {
    throw new Error('Please enter a valid URL (e.g., youtube.com)');
  }

  return url;
}
