'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import type { ShareSettings } from '@/lib/sharingTypes';

/**
 * Reserved top-level paths that should never be used as public share IDs.
 */
const RESERVED_SHARE_IDS = new Set(['public', 'stats', 'login', 'privacy', 'god']);

function normalizeShareSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function getShareBaseSlug(email: string | null | undefined): string {
  const emailPrefix = (email || '').split('@')[0] || '';
  const normalized = normalizeShareSlug(emailPrefix);

  if (!normalized || RESERVED_SHARE_IDS.has(normalized)) {
    return 'user';
  }

  return normalized;
}

async function resolveUniqueShareId(baseSlug: string, userId: string): Promise<string> {
  for (let suffix = 0; suffix < 500; suffix += 1) {
    const candidate = suffix === 0 ? baseSlug : `${baseSlug}-${suffix + 1}`;
    const mappingDocRef = doc(db, 'shareIdMappings', candidate);
    const mappingDoc = await getDoc(mappingDocRef);

    if (!mappingDoc.exists()) {
      return candidate;
    }

    const mappingData = mappingDoc.data() as { userId?: string };
    if (mappingData.userId === userId) {
      return candidate;
    }
  }

  const fallback = `${baseSlug}-${Date.now().toString(36)}`;
  return normalizeShareSlug(fallback);
}

export function useShareSettings() {
  const { user } = useAuth();
  const [shareSettings, setShareSettings] = useState<ShareSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!user?.uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear sharing data when user is not authenticated
      setShareSettings(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    // Set up real-time listener
    const shareDocRef = doc(db, 'users', user.uid, 'private', 'shareSettings');
    const unsubscribe = onSnapshot(
      shareDocRef,
      (docSnapshot) => {
        if (docSnapshot.exists()) {
          setShareSettings(docSnapshot.data() as ShareSettings);
        } else {
          // No share settings yet - user hasn't enabled sharing
          setShareSettings(null);
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error fetching share settings:', err);
        setError(err as Error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid]);

  /**
   * Enable public sharing
   */
  const enableSharing = async (): Promise<string | null> => {
    if (!user?.uid) return null;

    try {
      const shareDocRef = doc(db, 'users', user.uid, 'private', 'shareSettings');

      // Check if share settings already exist
      const existingDoc = await getDoc(shareDocRef);
      const existingSettings = existingDoc.exists() ? (existingDoc.data() as ShareSettings) : null;
      const previousShareId = existingSettings?.shareId;

      const baseSlug = getShareBaseSlug(user.email);
      const shareId = await resolveUniqueShareId(baseSlug, user.uid);

      const settings: ShareSettings = {
        enabled: true,
        shareId,
        createdAt: existingSettings
          ? existingSettings.createdAt
          : Date.now(),
        updatedAt: Date.now(),
      };

      await setDoc(shareDocRef, settings);

      // Also create a mapping document for lookups
      const mappingDocRef = doc(db, 'shareIdMappings', shareId);
      await setDoc(mappingDocRef, {
        userId: user.uid,
        enabled: true,
        updatedAt: Date.now(),
      });

      if (previousShareId && previousShareId !== shareId) {
        const previousMappingDocRef = doc(db, 'shareIdMappings', previousShareId);
        await setDoc(
          previousMappingDocRef,
          {
            userId: user.uid,
            enabled: false,
            updatedAt: Date.now(),
          },
          { merge: true }
        );
      }

      return shareId;
    } catch (err) {
      console.error('Error enabling sharing:', err);
      setError(err as Error);
      return null;
    }
  };

  /**
   * Disable public sharing
   */
  const disableSharing = async (): Promise<void> => {
    if (!user?.uid || !shareSettings?.shareId) return;

    try {
      const shareDocRef = doc(db, 'users', user.uid, 'private', 'shareSettings');

      await setDoc(shareDocRef, {
        ...shareSettings,
        enabled: false,
        updatedAt: Date.now(),
      });

      // Update mapping document
      const mappingDocRef = doc(db, 'shareIdMappings', shareSettings.shareId);
      await setDoc(mappingDocRef, {
        userId: user.uid,
        enabled: false,
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.error('Error disabling sharing:', err);
      setError(err as Error);
    }
  };

  /**
   * Toggle sharing on/off
   */
  const toggleSharing = async (): Promise<string | null> => {
    if (shareSettings?.enabled) {
      await disableSharing();
      return null;
    } else {
      return await enableSharing();
    }
  };

  return {
    shareSettings,
    loading,
    error,
    enableSharing,
    disableSharing,
    toggleSharing,
    isEnabled: shareSettings?.enabled ?? false,
  };
}

/**
 * Hook to fetch user data by share ID (for public access)
 */
export function usePublicUserData(shareId: string | null) {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!shareId) {
      setUserId(null);
      setLoading(false);
      return;
    }

    const fetchUserId = async () => {
      try {
        const mappingDocRef = doc(db, 'shareIdMappings', shareId);
        const mappingDoc = await getDoc(mappingDocRef);

        if (mappingDoc.exists()) {
          const data = mappingDoc.data();
          if (data.enabled) {
            setUserId(data.userId);
          } else {
            setError(new Error('Sharing is disabled for this user'));
          }
        } else {
          setError(new Error('Share link not found'));
        }
      } catch (err) {
        console.error('Error fetching user ID from share ID:', err);
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };

    fetchUserId();
  }, [shareId]);

  return { userId, loading, error };
}
