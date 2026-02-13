import type { Group } from '../types/Group';
import type { LimitTarget } from '../types/Limit';

/**
 * Recursively expands a group to all its URLs (handles nested groups)
 */
function expandGroupUrls(group: Group, allGroups: Group[], visited: Set<string> = new Set()): string[] {
  // Prevent infinite loops from circular references
  if (visited.has(group.id)) {
    console.warn(`Circular group reference detected: ${group.id}`);
    return [];
  }

  visited.add(group.id);
  const urls: string[] = [];

  for (const item of group.items) {
    if (item.startsWith('group:')) {
      // Nested group - recurse
      const nestedGroup = allGroups.find(g => g.id === item);
      if (nestedGroup) {
        urls.push(...expandGroupUrls(nestedGroup, allGroups, visited));
      }
    } else {
      // Direct URL
      urls.push(item);
    }
  }

  return urls;
}

/**
 * Expands limit targets to actual URLs by resolving group references.
 * This is the core function that makes groups the single source of truth.
 *
 * @param targets - Array of limit targets (groups or direct URLs)
 * @param groups - All available groups (to resolve references)
 * @returns Array of unique URLs
 */
export function expandTargetsToUrls(
  targets: LimitTarget[],
  groups: Group[]
): string[] {
  const urls: string[] = [];
  const seenUrls = new Set<string>(); // Prevent duplicates

  for (const target of targets) {
    if (target.type === 'url') {
      // Direct URL target
      if (!seenUrls.has(target.id)) {
        urls.push(target.id);
        seenUrls.add(target.id);
      }
    } else if (target.type === 'group') {
      // Group target - recursively expand
      const group = groups.find(g => g.id === target.id);
      if (group) {
        const groupUrls = expandGroupUrls(group, groups);
        for (const url of groupUrls) {
          if (!seenUrls.has(url)) {
            urls.push(url);
            seenUrls.add(url);
          }
        }
      } else {
        console.warn(`Group not found: ${target.id}`);
      }
    }
  }

  return urls;
}

/**
 * Checks if a URL is already present in the expanded targets
 *
 * @param url - The URL to check
 * @param targets - Array of limit targets
 * @param groups - All available groups
 * @returns true if the URL is already present
 */
export function isUrlInTargets(
  url: string,
  targets: LimitTarget[],
  groups: Group[]
): boolean {
  const expandedUrls = expandTargetsToUrls(targets, groups);
  return expandedUrls.includes(url);
}
