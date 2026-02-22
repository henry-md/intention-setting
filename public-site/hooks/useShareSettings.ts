'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import type { ShareSettings } from '@/lib/sharingTypes';

/**
 * Generates a unique share ID for a user
 * Uses a combination of timestamp and random string for uniqueness
 */
function generateShareId(): string {
  const timestamp = Date.now().toString(36);
  const randomStr = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${randomStr}`;
}

export function useShareSettings() {
  const { user } = useAuth();
  const [shareSettings, setShareSettings] = useState<ShareSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!user?.uid) {
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
      let shareId: string;

      if (existingDoc.exists()) {
        // Use existing shareId
        shareId = (existingDoc.data() as ShareSettings).shareId;
      } else {
        // Generate new shareId
        shareId = generateShareId();
      }

      const settings: ShareSettings = {
        enabled: true,
        shareId,
        createdAt: existingDoc.exists()
          ? (existingDoc.data() as ShareSettings).createdAt
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
