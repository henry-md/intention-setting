import React, { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';
import type { User } from '../types/User';
import { ReorderList } from '../components/ui/reorder-list';
import { normalizeUrl, getNormalizedHostname } from '../utils/urlNormalization';

interface Intention {
  intention: string;
  url: string;
  timestamp: string;
  timeLimit: number;
}

interface HomeProps {
  onShowAccount: () => void;
  user: User | null;
}

const Home: React.FC<HomeProps> = ({ onShowAccount, user }) => {
  const [urlInput, setUrlInput] = useState('');
  const [urls, setUrls] = useState<string[]>([]);
  const [urlError, setUrlError] = useState('');
  const [loading, setLoading] = useState(true);
  const [intentions, setIntentions] = useState<Intention[]>([]);
  const [isYouTube, setIsYouTube] = useState(false);

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

  // Detect if current tab is YouTube
  useEffect(() => {
    const checkIfYouTube = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        setIsYouTube(tab.url.includes('youtube.com'));
      }
    };
    checkIfYouTube();
  }, []);

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

    // Normalize URL to strip common prefixes (www., m., mobile.)
    const normalizedUrl = normalizeUrl(trimmedUrl);

    if (urls.includes(normalizedUrl)) {
      setUrlError('This URL is already in the list');
      return;
    }

    const newUrls = [...urls, normalizedUrl];
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

  // Handle URL reordering
  const handleReorderUrls = async (reorderedElements: React.ReactElement[]) => {
    // Extract URLs from the reordered React elements using data-url attribute
    const newUrls = reorderedElements.map(element => {
      const props = element.props as { 'data-url'?: string };
      return props['data-url'] as string;
    });
    setUrls(newUrls);
    await saveUrlsToFirestore(newUrls);
  };

  // Handle YouTube "stop after this video" button
  const handleStopAfterVideo = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('Current tab:', tab?.url, 'Tab ID:', tab?.id);

      if (tab?.id) {
        // Inject CSS from file
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['/youtube/youtube.css']
        });

        // Inject JS from file
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['/youtube/youtube.js']
        });
      } else {
        console.error('No tab ID found');
      }
    } catch (error) {
      console.error('Error injecting YouTube scripts:', error);
      console.error('Error details:', error);
    }
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
      <div className="h-screen w-full flex items-center justify-center">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col space-y-4 p-4 overflow-y-auto">
      {/* Header with title and profile icon */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Intention Setting</h3>
        <button onClick={onShowAccount} className="purple-button" aria-label="Account">
          {/* Profile Icon SVG */}
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </button>
      </div>

      <div className="flex flex-col space-y-4 w-full">
        {/* YouTube Stop After Video Button */}
        {isYouTube && (
          <button
            onClick={handleStopAfterVideo}
            className="w-full px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
          >
            I'll stop after this video!
          </button>
        )}

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

            {/* Normalized URL Preview */}
            {urlInput && !urlError && (() => {
              try {
                let previewUrl = urlInput.trim();
                if (!previewUrl.startsWith('http://') && !previewUrl.startsWith('https://')) {
                  previewUrl = 'https://' + previewUrl;
                }
                if (isValidUrl(previewUrl)) {
                  const normalized = getNormalizedHostname(previewUrl);
                  const original = new URL(previewUrl).hostname;
                  if (normalized !== original) {
                    return (
                      <p className="text-blue-400 text-xs">
                        Will be tracked as: {normalized}
                      </p>
                    );
                  }
                }
              } catch (error) {
                console.error('Error parsing URL:', error);
              }
              return null;
            })()}

            {/* Error Message */}
            {urlError && (
              <p className="text-red-400 text-sm">{urlError}</p>
            )}
          </div>

          {/* URL List */}
          {urls.length > 0 && (
            <div className="flex flex-col space-y-2">
              <ReorderList
                withDragHandle={true}
                className="gap-2 max-h-60 overflow-y-auto"
                itemClassName="bg-slate-700 hover:bg-slate-600 rounded-lg"
                onReorderFinish={handleReorderUrls}
              >
                {urls.map((url) => (
                  <div
                    key={url}
                    data-url={url}
                    className="pr-4 py-2 text-white text-sm flex items-center justify-between w-full"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${getNormalizedHostname(url)}&sz=32`}
                        alt=""
                        className="w-4 h-4 flex-shrink-0"
                        onError={(e) => {
                          // Fallback to a default icon if favicon fails to load
                          e.currentTarget.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="%23666"/></svg>';
                        }}
                      />
                      <span className="flex-1 truncate">{displayUrl(url)}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteUrl(url);
                      }}
                      className="text-white hover:opacity-70 transition-opacity ml-2 flex-shrink-0"
                      title="Delete URL"
                    >
                      <X size={14} strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
              </ReorderList>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Home;
