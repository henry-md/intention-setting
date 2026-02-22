import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { expandTargetsToUrls } from './ruleHelpers';
import type { Rule } from '../types/Rule';
import type { Group } from '../types/Group';
import { getNormalizedHostname } from './urlNormalization';

interface SiteRuleData {
  ruleType: 'hard' | 'soft' | 'session';
  timeLimit: number; // in seconds (converted from Rule.timeLimit which is in minutes)
  plusOnes?: number;
  plusOneDuration?: number; // in seconds
  ruleId: string;
}

/**
 * Syncs all URLs from rules to chrome.storage for content script access.
 * This should be called whenever rules or groups are updated.
 *
 * Stores data as a map of normalized hostnames to rule data:
 * {
 *   "snapchat.com": { ruleType: "hard", timeLimit: 3600, ruleId: "..." },  // timeLimit in seconds (converted from minutes)
 *   "instagram.com": { ruleType: "soft", timeLimit: 5400, plusOnes: 3, ... }
 * }
 */
export async function syncRulesToStorage(userId: string): Promise<void> {
  try {
    console.log('[syncRulesToStorage] Starting sync for userId:', userId);

    // Fetch rules and groups from Firestore
    const userDocRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      console.log('[syncRulesToStorage] User doc does not exist, clearing storage');
      await chrome.storage.local.set({ siteRules: {} });
      return;
    }

    const data = userDoc.data();
    const rules: Rule[] = data.rules || [];
    const groups: Group[] = data.groups || [];

    console.log('[syncRulesToStorage] Fetched from Firestore:', {
      rulesCount: rules.length,
      groupsCount: groups.length,
      rules: rules,
      groups: groups
    });

    // Build a map of normalized hostname -> rule data
    const siteRules: Record<string, SiteRuleData> = {};

    for (const rule of rules) {
      console.log('[syncRulesToStorage] Processing rule:', rule.id, 'type:', rule.type);

      // Expand targets to get all URLs
      const urls = expandTargetsToUrls(rule.targets, groups);
      console.log('[syncRulesToStorage] Expanded to URLs:', urls);

      // For each URL, store the rule data
      for (const url of urls) {
        const hostname = getNormalizedHostname(url);

        // If a site already has a rule, keep the first one (could be enhanced with priority logic)
        if (!siteRules[hostname]) {
          siteRules[hostname] = {
            ruleType: rule.type,
            timeLimit: rule.timeLimit * 60, // Convert minutes to seconds for content script
            ruleId: rule.id
          };

          // Add soft rule specific fields
          if (rule.type === 'soft') {
            siteRules[hostname].plusOnes = rule.plusOnes;
            siteRules[hostname].plusOneDuration = rule.plusOneDuration;
          }

          console.log('[syncRulesToStorage] Added site:', hostname, siteRules[hostname]);
        }
      }
    }

    console.log('[syncRulesToStorage] Final siteRules map:', siteRules);
    await chrome.storage.local.set({ siteRules });

    console.log(`[syncRulesToStorage] ✓ Synced ${Object.keys(siteRules).length} sites to chrome.storage from ${rules.length} rules`);
  } catch (error) {
    console.error('[syncRulesToStorage] ERROR:', error);
  }
}
