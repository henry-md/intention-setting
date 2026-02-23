export interface CompiledRuleForSelection {
  ruleType: 'hard' | 'soft' | 'session';
  timeLimit: number;
  plusOnes?: number;
  plusOneDuration?: number;
  siteKeys: string[];
}

export type CompiledRulesForSelection = Record<string, CompiledRuleForSelection>;
export type SiteRuleIdsForSelection = Record<string, string[]>;

const getTotalAllowedSeconds = (rule: CompiledRuleForSelection): number => {
  if (rule.ruleType === 'soft') {
    const plusOnes = Math.max(0, rule.plusOnes || 0);
    const plusOneDuration = Math.max(0, rule.plusOneDuration || 0);
    return rule.timeLimit + (plusOnes * plusOneDuration);
  }
  return rule.timeLimit;
};

const getRuleTypeRank = (ruleType: 'hard' | 'soft' | 'session'): number => {
  if (ruleType === 'hard') return 0;
  if (ruleType === 'soft') return 1;
  return 2;
};

/**
 * Returns a single non-session rule ID for `siteKey`: the most restrictive rule,
 * defined as the one allowing the least total time.
 */
export function getMostRestrictiveRuleIdForSite(
  siteKey: string,
  siteRuleIds: SiteRuleIdsForSelection,
  compiledRules: CompiledRulesForSelection
): string | null {
  const mappedRuleIds = siteRuleIds[siteKey] || [];
  const candidateRuleIds = mappedRuleIds.length > 0
    ? mappedRuleIds
    : Object.entries(compiledRules)
        .filter(([, rule]) => rule.ruleType !== 'session' && rule.siteKeys.includes(siteKey))
        .map(([ruleId]) => ruleId);

  let bestRuleId: string | null = null;
  let bestRule: CompiledRuleForSelection | null = null;

  for (const ruleId of candidateRuleIds) {
    const rule = compiledRules[ruleId];
    if (!rule || rule.ruleType === 'session' || rule.timeLimit <= 0) {
      continue;
    }

    if (!bestRule) {
      bestRule = rule;
      bestRuleId = ruleId;
      continue;
    }

    const ruleAllowance = getTotalAllowedSeconds(rule);
    const bestAllowance = getTotalAllowedSeconds(bestRule);
    if (ruleAllowance < bestAllowance) {
      bestRule = rule;
      bestRuleId = ruleId;
      continue;
    }

    if (ruleAllowance === bestAllowance) {
      const ruleRank = getRuleTypeRank(rule.ruleType);
      const bestRank = getRuleTypeRank(bestRule.ruleType);
      if (ruleRank < bestRank) {
        bestRule = rule;
        bestRuleId = ruleId;
        continue;
      }

      if (ruleRank === bestRank && rule.timeLimit < bestRule.timeLimit) {
        bestRule = rule;
        bestRuleId = ruleId;
      }
    }
  }

  return bestRuleId;
}
