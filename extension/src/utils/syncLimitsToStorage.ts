import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { expandTargetsToUrls } from './limitHelpers';
import type { Limit } from '../types/Limit';
import type { Group } from '../types/Group';

/**
 * Syncs all URLs from limits to chrome.storage for content script access.
 * This should be called whenever limits or groups are updated.
 */
export async function syncLimitsToStorage(userId: string): Promise<void> {
  try {
    console.log('[syncLimitsToStorage] Starting sync for userId:', userId);

    // Fetch limits and groups from Firestore
    const userDocRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      console.log('[syncLimitsToStorage] User doc does not exist, clearing storage');
      await chrome.storage.local.set({ userUrls: [] });
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

    // Expand all limits to get all URLs
    const allUrls = new Set<string>();
    for (const limit of limits) {
      console.log('[syncLimitsToStorage] Expanding limit:', limit.id, 'with targets:', limit.targets);
      const urls = expandTargetsToUrls(limit.targets, groups);
      console.log('[syncLimitsToStorage] Expanded to URLs:', urls);
      urls.forEach(url => allUrls.add(url));
    }

    // Convert to array and sync to chrome.storage
    const urlArray = Array.from(allUrls);
    console.log('[syncLimitsToStorage] Final URL array to sync:', urlArray);
    await chrome.storage.local.set({ userUrls: urlArray });

    console.log(`[syncLimitsToStorage] ✓ Synced ${urlArray.length} URLs to chrome.storage from ${limits.length} limits`);
  } catch (error) {
    console.error('[syncLimitsToStorage] ERROR:', error);
  }
}
