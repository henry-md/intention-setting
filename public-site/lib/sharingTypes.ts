/**
 * Sharing settings stored in Firestore under users/{uid}/shareSettings
 */
export interface ShareSettings {
  enabled: boolean;
  shareId: string; // Unique identifier for the public URL
  createdAt: number;
  updatedAt: number;
}

/**
 * What data to share publicly
 * For now, everything is shared when enabled
 * Future: Allow granular control over what stats are public
 */
export interface SharePreferences {
  showRules: boolean;
  showGroups: boolean;
  showTimeTracking: boolean;
  showOverallStats: boolean;
}

export const DEFAULT_SHARE_PREFERENCES: SharePreferences = {
  showRules: true,
  showGroups: true,
  showTimeTracking: true,
  showOverallStats: true,
};
