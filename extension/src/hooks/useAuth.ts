import { useEffect, useState } from 'react';
import type { User } from '../types/User';

const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Initial load of user from local storage
    chrome.storage.local.get(['user'], (result) => {
      setUser(result.user || null);
      setLoading(false);
    });

    // Make sure user is always in sync with local storage
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.user) {
        setUser(changes.user.newValue || null);
      }
    };
    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const handleSignIn = () => {
    // Send message to background script to initiate sign-in.
    // The background script will update chrome.storage on success.
    chrome.runtime.sendMessage({ action: 'signIn' });
  };

  const handleSignOut = () => {
    // Send message to background script to initiate sign-out.
    // The background script will clear chrome.storage.
    chrome.runtime.sendMessage({ action: 'signOut' });
  };

  return { user, loading, handleSignIn, handleSignOut };
};

export default useAuth;
