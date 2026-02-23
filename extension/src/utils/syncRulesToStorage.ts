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

interface CompiledRuleData {
  ruleType: 'hard' | 'soft' | 'session';
  timeLimit: number;
  ruleName?: string;
  plusOnes?: number;
  plusOneDuration?: number;
  siteKeys: string[];
}

interface RuleUsageEntry {
  timeSpent: number;
  lastUpdated: number;
}

function shouldReplacePrimaryRule(existing: SiteRuleData, nextRule: Rule): boolean {
  if (existing.ruleType === 'session' && nextRule.type !== 'session') {
    return true;
  }

  if (existing.ruleType !== 'session' && nextRule.type === 'session') {
    return false;
  }

  if (existing.ruleType !== 'session' && nextRule.type !== 'session') {
    const nextLimitSeconds = nextRule.timeLimit * 60;
    return nextLimitSeconds < existing.timeLimit;
  }

  return false;
}

/**
 * Syncs all URLs from rules to chrome.storage for content script access.
 * This should be called whenever rules or groups are updated.
 *
 * Stores compiled local indexes used by content/background scripts:
 * - siteRules: primary rule per normalized hostname (for UI/session behavior)
 * - siteRuleIds: all non-session rule IDs per site (for aggregated enforcement)
 * - compiledRules: rule metadata keyed by rule ID
 * - ruleUsageData: local per-rule usage counters
 *
 * siteRules example:
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
      await chrome.storage.local.set({
        siteRules: {},
        siteRuleIds: {},
        compiledRules: {},
        ruleUsageData: {}
      });
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

    // Build a map of normalized hostname -> primary rule data
    const siteRules: Record<string, SiteRuleData> = {};
    // Build a map of site -> all applicable non-session rule IDs
    const siteRuleIds: Record<string, string[]> = {};
    // Build rule lookup for background aggregation checks
    const compiledRules: Record<string, CompiledRuleData> = {};

    for (const rule of rules) {
      console.log('[syncRulesToStorage] Processing rule:', rule.id, 'type:', rule.type);

      // Expand targets to get all URLs
      const urls = expandTargetsToUrls(rule.targets, groups);
      console.log('[syncRulesToStorage] Expanded to URLs:', urls);
      const uniqueSiteKeys = new Set<string>();

      // For each URL, store the primary site rule and reverse indexes
      for (const url of urls) {
        const hostname = getNormalizedHostname(url);
        if (!hostname) continue;
        uniqueSiteKeys.add(hostname);

        const nextSiteRule: SiteRuleData = {
          ruleType: rule.type,
          timeLimit: rule.timeLimit * 60, // Convert minutes to seconds for content script
          ruleId: rule.id
        };

        if (rule.type === 'soft') {
          nextSiteRule.plusOnes = rule.plusOnes;
          nextSiteRule.plusOneDuration = rule.plusOneDuration;
        }

        if (!siteRules[hostname] || shouldReplacePrimaryRule(siteRules[hostname], rule)) {
          siteRules[hostname] = nextSiteRule;
          console.log('[syncRulesToStorage] Updated primary site rule:', hostname, siteRules[hostname]);
        }

        if (rule.type !== 'session') {
          if (!siteRuleIds[hostname]) {
            siteRuleIds[hostname] = [];
          }
          if (!siteRuleIds[hostname].includes(rule.id)) {
            siteRuleIds[hostname].push(rule.id);
          }
        }
      }

      compiledRules[rule.id] = {
        ruleType: rule.type,
        timeLimit: rule.timeLimit * 60,
        ruleName: rule.name,
        siteKeys: Array.from(uniqueSiteKeys)
      };

      if (rule.type === 'soft') {
        compiledRules[rule.id].plusOnes = rule.plusOnes;
        compiledRules[rule.id].plusOneDuration = rule.plusOneDuration;
      }
    }

    const usageStorage = await chrome.storage.local.get(['ruleUsageData', 'siteTimeData']);
    const existingRuleUsageData: Record<string, RuleUsageEntry> = usageStorage.ruleUsageData || {};
    const siteTimeData: Record<string, { timeSpent: number }> = usageStorage.siteTimeData || {};
    const ruleUsageData: Record<string, RuleUsageEntry> = {};
    const now = Date.now();

    for (const rule of rules) {
      if (rule.type === 'session') continue;
      const compiledRule = compiledRules[rule.id];
      const computedTimeSpent = compiledRule
        ? compiledRule.siteKeys.reduce((sum, siteKey) => sum + (siteTimeData[siteKey]?.timeSpent || 0), 0)
        : 0;
      const existingUsage = existingRuleUsageData[rule.id];

      ruleUsageData[rule.id] = {
        timeSpent: computedTimeSpent,
        lastUpdated: existingUsage?.lastUpdated || now
      };
    }

    console.log('[syncRulesToStorage] Final siteRules map:', siteRules);
    console.log('[syncRulesToStorage] Final siteRuleIds map:', siteRuleIds);
    console.log('[syncRulesToStorage] Final compiledRules map:', compiledRules);
    await chrome.storage.local.set({
      siteRules,
      siteRuleIds,
      compiledRules,
      ruleUsageData
    });

    console.log(
      `[syncRulesToStorage] ✓ Synced ${Object.keys(siteRules).length} sites, ${rules.length} rules, and ${Object.keys(ruleUsageData).length} usage counters`
    );
  } catch (error) {
    console.error('[syncRulesToStorage] ERROR:', error);
  }
}
