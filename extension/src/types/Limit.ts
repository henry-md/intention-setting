/**
 * Type definition used by Limits.tsx to manage time limits on URLs and groups.
 * Stored in Firestore under users/{uid}/limits as an array.
 */

export interface LimitTarget {
  type: 'url' | 'group';
  id: string; // URL or group ID
}

export interface Limit {
  id: string;
  name?: string; // Optional name for the limit
  type: 'hard' | 'soft' | 'session';
  // Single source of truth: references to groups or direct URLs
  // Use expandTargetsToUrls() from utils/limitHelpers.ts to get actual URLs
  targets: LimitTarget[];
  // Time limit in minutes
  timeLimit: number;
  // For soft limits - how many plus ones remaining
  plusOnes?: number;
  // For soft limits - duration of each plus one in seconds
  plusOneDuration?: number;
  createdAt: string;
}
