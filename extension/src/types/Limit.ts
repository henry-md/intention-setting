/**
 * Type definition used by Limits.tsx to manage time limits on URLs and groups.
 * Stored in Firestore under users/{uid}/limits as an array.
 */

export interface LimitUrl {
  url: string;
  source: string; // Group name or 'direct' for directly added URLs
}

export interface LimitTarget {
  type: 'url' | 'group';
  id: string; // URL or group ID
}

export interface Limit {
  id: string;
  name?: string; // Optional name for the limit
  type: 'hard' | 'soft' | 'session';
  // Visual representation - what to display (groups + individual URLs)
  targets: LimitTarget[];
  // Actual URLs for validation/matching (expanded from groups)
  urls: LimitUrl[];
  // Time limit in minutes
  timeLimit: number;
  // For soft limits - how many plus ones remaining
  plusOnes?: number;
  // For soft limits - duration of each plus one in seconds
  plusOneDuration?: number;
  createdAt: string;

  // Legacy fields for backwards compatibility (will be migrated)
  targetType?: 'url' | 'group';
  targetId?: string;
}
