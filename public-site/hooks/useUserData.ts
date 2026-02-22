'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';

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
  lastDailyResetTimestamp?: number;
}

export function useUserData() {
  const { user } = useAuth();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      setUserData(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Set up real-time listener
    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          setUserData({
            rules: data.rules || [],
            groups: data.groups || [],
            timeTracking: data.timeTracking || {},
            lastDailyResetTimestamp: data.lastDailyResetTimestamp,
          });
        } else {
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
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  return { userData, loading, error };
}
