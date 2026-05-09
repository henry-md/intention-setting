/**
 * Type definition used by Rules.tsx to manage time rules on URLs and groups.
 * Stored in Firestore under users/{uid}/rules as an array.
 */

export interface RuleTarget {
  type: 'url' | 'group';
  id: string; // URL or group ID
}

export type RuleType = 'hard' | 'soft' | 'session' | 'time';

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface TimeLimitSchedule {
  days: WeekdayKey[];
  startTime: string;
  endTime: string;
}

export interface Rule {
  id: string;
  name?: string; // Optional name for the rule
  type: RuleType;
  // Single source of truth: references to groups or direct URLs
  // Use expandTargetsToUrls() from utils/ruleHelpers.ts to get actual URLs
  targets: RuleTarget[];
  // Time limit in minutes
  timeLimit: number;
  // For time rules - local days and clock window when the targets are allowed
  schedule?: TimeLimitSchedule;
  // For soft limits - how many plus ones remaining
  plusOnes?: number;
  // For soft limits - duration of each plus one in seconds
  plusOneDuration?: number;
  createdAt: string;
}
