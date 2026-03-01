'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import {
  type DailyUsageHistory,
  parseLegacyDailyUsageHistory
} from '@/lib/dailyUsageHistory';

export interface RuleTarget {
  type: 'url' | 'group';
  id: string;
}

export interface Rule {
  id: string;
  name?: string;
  type: 'hard' | 'soft' | 'session';
  targets: RuleTarget[];
  timeLimit: number; // in minutes
  plusOnes?: number;
  plusOneDuration?: number; // in seconds
  createdAt: string;
}

export interface Group {
  id: string;
  name: string;
  items: string[];
  createdAt: string;
}

export interface SiteTimeData {
  timeSpent: number; // in seconds
  timeLimit: number; // in seconds
  lastUpdated: number;
}

export interface UserData {
  rules: Rule[];
  groups: Group[];
  timeTracking: Record<string, SiteTimeData>;
  dailyUsageHistory?: DailyUsageHistory;
  lastDailyResetTimestamp?: number;
}

export function useUserData() {
  const { user } = useAuth();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [hasUserDocument, setHasUserDocument] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- start loading immediately for a new authenticated user
    setLoading(true);

    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          setHasUserDocument(true);
          const data = docSnapshot.data();

          setUserData({
            rules: data.rules || [],
            groups: data.groups || [],
            timeTracking: data.timeTracking || {},
            dailyUsageHistory: parseLegacyDailyUsageHistory(data.dailyUsageHistory),
            lastDailyResetTimestamp: data.lastDailyResetTimestamp,
          });
        } else {
          setHasUserDocument(false);
          setUserData({
            rules: [],
            groups: [],
            timeTracking: {},
          });
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching user data:', err);
        setError(err as Error);
        setHasUserDocument(null);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  if (!user?.uid) {
    return { userData: null, hasUserDocument: null, loading: false, error: null };
  }

  return { userData, hasUserDocument, loading, error };
}
