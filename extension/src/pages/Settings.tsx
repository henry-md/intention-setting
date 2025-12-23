import React, { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import type { User } from '../types/User';

interface SettingsProps {
  onBack: () => void;
  user: User | null;
}

const Settings: React.FC<SettingsProps> = ({ onBack, user }) => {
  const [urlInput, setUrlInput] = useState('');
  const [urls, setUrls] = useState<string[]>([]);
  const [urlError, setUrlError] = useState('');
  const [loading, setLoading] = useState(true);
  const [intentions, setIntentions] = useState<any[]>([]);

  // Log intentions whenever they change
  useEffect(() => {
    if (intentions.length > 0) {
      console.log('Intentions state updated:', intentions);
    }
  }, [intentions]);

  // Fetch URLs and intentions from Firestore on mount
  useEffect(() => {
    const fetchData = async () => {
      if (!user?.uid) {
        setLoading(false);
        return;
      }

      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
          const data = userDoc.data();
          const fetchedUrls = data.urls || [];
          const fetchedIntentions = data.intentions || [];

          setUrls(fetchedUrls);
          setIntentions(fetchedIntentions);

          // Console log intentions
          console.log('User intentions:', fetchedIntentions);
          console.log('Total intentions:', fetchedIntentions.length);

          // Also save to Chrome storage for content script access
          await chrome.storage.local.set({ userUrls: fetchedUrls });
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user?.uid]);

  // Save URLs to Firestore and Chrome storage
  const saveUrlsToFirestore = async (newUrls: string[]) => {
    if (!user?.uid) return;

    try {
      // Save to Firestore
      const userDocRef = doc(db, 'users', user.uid);
      await setDoc(userDocRef, { urls: newUrls }, { merge: true });

      // Save to Chrome storage for content script access
      await chrome.storage.local.set({ userUrls: newUrls });
    } catch (error) {
      console.error('Error saving URLs:', error);
      setUrlError('Failed to save URL');
    }
  };

  // URL validation function
  const isValidUrl = (url: string): boolean => {
    try {
      const urlObj = new URL(url);
      // Check that the hostname contains at least one dot (e.g., youtube.com, not just youtube)
      return urlObj.hostname.includes('.');
    } catch {
      return false;
    }
  };

  // Add URL handler
  const handleAddUrl = async () => {
    let trimmedUrl = urlInput.trim();

    if (!trimmedUrl) {
      setUrlError('Please enter a URL');
      return;
    }

    // Automatically prepend https:// if no protocol is specified
    if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
      trimmedUrl = 'https://' + trimmedUrl;
    }

    if (!isValidUrl(trimmedUrl)) {
      setUrlError('Please enter a valid URL (e.g., youtube.com)');
      return;
    }

    if (urls.includes(trimmedUrl)) {
      setUrlError('This URL is already in the list');
      return;
    }

    const newUrls = [...urls, trimmedUrl];
    setUrls(newUrls);
    setUrlInput('');
    setUrlError('');
    await saveUrlsToFirestore(newUrls);
  };

  // Delete URL handler
  const handleDeleteUrl = async (urlToDelete: string) => {
    const newUrls = urls.filter(url => url !== urlToDelete);
    setUrls(newUrls);
    await saveUrlsToFirestore(newUrls);
  };

  // Handle Enter key press
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleAddUrl();
    }
  };

  // Display URL without protocol
  const displayUrl = (url: string): string => {
    return url.replace(/^https?:\/\//, '');
  };

  if (loading) {
    return (
      <div className="w-80 flex flex-col space-y-4 items-center p-4">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  return (
    <div className="w-80 flex flex-col space-y-4">
      {/* Header with back button and title */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="purple-button">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" className="h-4 w-4" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="text-lg font-semibold absolute left-1/2 -translate-x-1/2">Manage URLs</h3>
        <div className="w-[40px]"></div>
      </div>

      <div className="flex flex-col space-y-4 w-full">
        {/* URL Management Section */}
        <div className="flex flex-col space-y-3">

          {/* URL Input */}
          <div className="flex flex-col space-y-2">
            <div className="flex space-x-2">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value);
                  setUrlError('');
                }}
                onKeyPress={handleKeyPress}
                placeholder="Enter URL (e.g., youtube.com)"
                className="flex-1 px-3 py-2 border border-gray-600 bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
              <button
                onClick={handleAddUrl}
                className="purple-button"
                title="Add URL"
              >
                <Plus size={20} />
              </button>
            </div>

            {/* Error Message */}
            {urlError && (
              <p className="text-red-400 text-sm">{urlError}</p>
            )}
          </div>

          {/* URL List */}
          {urls.length > 0 && (
            <div className="flex flex-col space-y-2">
              <div className="flex flex-wrap gap-2 max-h-60 overflow-y-auto">
                {urls.map((url, index) => (
                  <div
                    key={index}
                    className="bg-gray-800 rounded-full border border-gray-700 hover:bg-gray-700 transition-colors flex flex-row items-center"
                  >
                    <span className="text-xs pl-2 pr-0 py-0" title={url}>
                      {displayUrl(url)}
                    </span>
                    <button
                      onClick={() => handleDeleteUrl(url)}
                      className="text-white hover:opacity-100 opacity-70 transition-opacity no-focus !p-[5px]"
                      title="Delete URL"
                    >
                      <X size={10} strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Settings;