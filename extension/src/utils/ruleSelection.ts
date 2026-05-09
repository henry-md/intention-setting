export interface CompiledRuleForSelection {
  ruleType: 'hard' | 'soft' | 'session' | 'time';
  timeLimit: number;
  plusOnes?: number;
  plusOneDuration?: number;
  siteKeys: string[];
}

export type CompiledRulesForSelection = Record<string, CompiledRuleForSelection>;
export type SiteRuleIdsForSelection = Record<string, string[]>;

export const getTotalAllowedSeconds = (rule: CompiledRuleForSelection): number => {
  if (rule.ruleType === 'soft') {
    const plusOnes = Math.max(0, rule.plusOnes || 0);
    const plusOneDuration = Math.max(0, rule.plusOneDuration || 0);
    return rule.timeLimit + (plusOnes * plusOneDuration);
  }
  return rule.timeLimit;
};

const getRuleTypeRank = (ruleType: 'hard' | 'soft' | 'session' | 'time'): number => {
  if (ruleType === 'hard') return 0;
  if (ruleType === 'soft') return 1;
  if (ruleType === 'time') return 2;
  return 2;
};

/**
 * Returns a single duration rule ID for `siteKey`: the most restrictive rule,
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
        .filter(([, rule]) => rule.ruleType !== 'session' && rule.ruleType !== 'time' && rule.siteKeys.includes(siteKey))
        .map(([ruleId]) => ruleId);

  let bestRuleId: string | null = null;
  let bestRule: CompiledRuleForSelection | null = null;

  for (const ruleId of candidateRuleIds) {
    const rule = compiledRules[ruleId];
    if (!rule || rule.ruleType === 'session' || rule.ruleType === 'time' || rule.timeLimit <= 0) {
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

export function getApplicableTimeRuleIdsForSite(
  siteKey: string,
  siteRuleIds: SiteRuleIdsForSelection,
  compiledRules: CompiledRulesForSelection
): string[] {
  const mappedRuleIds = siteRuleIds[siteKey] || [];
  const candidateRuleIds = mappedRuleIds.length > 0
    ? mappedRuleIds
    : Object.entries(compiledRules)
        .filter(([, rule]) => rule.ruleType === 'time' && rule.siteKeys.includes(siteKey))
        .map(([ruleId]) => ruleId);

  return candidateRuleIds.filter((ruleId) => {
    const rule = compiledRules[ruleId];
    return !!rule && rule.ruleType === 'time' && rule.siteKeys.includes(siteKey);
  });
}
