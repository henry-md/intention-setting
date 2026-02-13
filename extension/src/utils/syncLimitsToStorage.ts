import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { expandTargetsToUrls } from './limitHelpers';
import type { Limit } from '../types/Limit';
import type { Group } from '../types/Group';
import { getNormalizedHostname } from './urlNormalization';

interface SiteLimitData {
  limitType: 'hard' | 'soft' | 'session';
  timeLimit: number;
  plusOnes?: number;
  plusOneDuration?: number;
  limitId: string;
}

/**
 * Syncs all URLs from limits to chrome.storage for content script access.
 * This should be called whenever limits or groups are updated.
 *
 * Stores data as a map of normalized hostnames to limit data:
 * {
 *   "snapchat.com": { limitType: "hard", timeLimit: 60, limitId: "..." },
 *   "instagram.com": { limitType: "soft", timeLimit: 90, plusOnes: 3, ... }
 * }
 */
export async function syncLimitsToStorage(userId: string): Promise<void> {
  try {
    console.log('[syncLimitsToStorage] Starting sync for userId:', userId);

    // Fetch limits and groups from Firestore
    const userDocRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      console.log('[syncLimitsToStorage] User doc does not exist, clearing storage');
      await chrome.storage.local.set({ siteLimits: {} });
      return;
    }

    const data = userDoc.data();
    const limits: Limit[] = data.limits || [];
    const groups: Group[] = data.groups || [];

    console.log('[syncLimitsToStorage] Fetched from Firestore:', {
      limitsCount: limits.length,
      groupsCount: groups.length,
      limits: limits,
      groups: groups
    });

    // Build a map of normalized hostname -> limit data
    const siteLimits: Record<string, SiteLimitData> = {};

    for (const limit of limits) {
      console.log('[syncLimitsToStorage] Processing limit:', limit.id, 'type:', limit.type);

      // Expand targets to get all URLs
      const urls = expandTargetsToUrls(limit.targets, groups);
      console.log('[syncLimitsToStorage] Expanded to URLs:', urls);

      // For each URL, store the limit data
      for (const url of urls) {
        const hostname = getNormalizedHostname(url);

        // If a site already has a limit, keep the first one (could be enhanced with priority logic)
        if (!siteLimits[hostname]) {
          siteLimits[hostname] = {
            limitType: limit.type,
            timeLimit: limit.timeLimit,
            limitId: limit.id
          };

          // Add soft limit specific fields
          if (limit.type === 'soft') {
            siteLimits[hostname].plusOnes = limit.plusOnes;
            siteLimits[hostname].plusOneDuration = limit.plusOneDuration;
          }

          console.log('[syncLimitsToStorage] Added site:', hostname, siteLimits[hostname]);
        }
      }
    }

    console.log('[syncLimitsToStorage] Final siteLimits map:', siteLimits);
    await chrome.storage.local.set({ siteLimits });

    console.log(`[syncLimitsToStorage] ✓ Synced ${Object.keys(siteLimits).length} sites to chrome.storage from ${limits.length} limits`);
  } catch (error) {
    console.error('[syncLimitsToStorage] ERROR:', error);
  }
}
