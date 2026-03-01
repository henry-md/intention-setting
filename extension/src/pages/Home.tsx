import React, { useState, useEffect } from 'react';
import type { User } from '../types/User';
import useAuth from '../hooks/useAuth';
import { useStripe } from '../hooks/useStripe';
import Spinner from '../components/Spinner';

interface HomeProps {
  user: User | null;
  onOpenManageSubscription: () => void;
}

const isScriptableTabUrl = (url: string) => {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return false;
  }

  return !(
    url.startsWith('https://chrome.google.com/webstore') ||
    url.startsWith('https://chromewebstore.google.com')
  );
};

const isYouTubeTabUrl = (url: string) => {
  if (!isScriptableTabUrl(url)) {
    return false;
  }

  return url.includes('youtube.com');
};

const formatUnknownError = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

/**
 * Account tab - shows user authentication status, premium status, and account actions.
 * Child of Popup.tsx, renders inside the Account tab.
 * Also shows YouTube stop button when on YouTube.
 */
const Home: React.FC<HomeProps> = ({ onOpenManageSubscription }) => {
  const { user, loading: authLoading, handleSignIn, handleSignOut } = useAuth();
  const {
    paymentStatus,
    isProcessing,
    subscription,
    handleUpgrade,
  } = useStripe(user, authLoading);
  const [isYouTube, setIsYouTube] = useState(false);

  // Detect if current tab is YouTube
  useEffect(() => {
    const checkIfYouTube = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      setIsYouTube(tab?.url ? isYouTubeTabUrl(tab.url) : false);
    };
    checkIfYouTube();
  }, []);

  // Handle YouTube "stop after this video" button
  const handleStopAfterVideo = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('Current tab:', tab?.url, 'Tab ID:', tab?.id);

      if (!tab?.id || !tab?.url) {
        console.error('[YouTube] Could not find active tab ID and URL.');
        return;
      }

      if (!isScriptableTabUrl(tab.url)) {
        console.warn('[YouTube] Active tab cannot be scripted by extensions.');
        return;
      }

      if (!isYouTubeTabUrl(tab.url)) {
        setIsYouTube(false);
        console.warn('[YouTube] Stop-after-video is only available on YouTube tabs.');
        return;
      }

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
    } catch (error) {
      console.error('[YouTube] Failed to inject stop-after-video script:', formatUnknownError(error));
    }
  };

  if (authLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Handle the case where the user is not signed in
  if (!user) {
    return (
      <div className="h-full w-full p-6 flex flex-col items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-4">Intention Setter</h2>
          <button onClick={handleSignIn} className="purple-button">
            Sign In with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col space-y-4 p-4 pb-20">
      {/* Header with title */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Intention Setting</h3>
      </div>

      {/* Account Information */}
      <div className="flex flex-col space-y-3 bg-zinc-800 border border-zinc-600 rounded-lg p-4">
        <div className="text-center">
          <p className="text-sm text-zinc-400 mb-1">Signed in as:</p>
          <p className="text-sm font-medium text-zinc-200">{user.email}</p>
        </div>

        {paymentStatus === 'loading' && (
          <div className="text-sm text-zinc-400 text-center">Checking payment status...</div>
        )}
        {paymentStatus === 'paid' && (
          <div className="flex flex-col items-center gap-3">
            <div className="mx-auto inline-flex items-center rounded-full border border-emerald-500/50 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-300">
              Premium Active
            </div>
            {subscription?.cancelAtPeriodEnd && (
              <p className="text-xs text-amber-300 text-center">
                Subscription is set to cancel at period end.
              </p>
            )}
            <button
              onClick={onOpenManageSubscription}
              className="w-full px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white font-medium rounded-lg transition-colors"
            >
              Manage Subscription
            </button>
          </div>
        )}
        {paymentStatus === 'unpaid' && (
          <button
            onClick={handleUpgrade}
            disabled={isProcessing}
            className="purple-button"
          >
            {isProcessing ? 'Processing...' : 'Upgrade to Premium'}
          </button>
        )}

        <button onClick={handleSignOut} className="purple-button">
          Sign Out
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

        {/* Info message about using Rules */}
        <div className="bg-zinc-800 border border-zinc-600 rounded-lg p-4">
          <p className="text-zinc-300 text-sm mb-2">
            To manage URLs and time rules:
          </p>
          <ul className="text-zinc-400 text-sm space-y-1 list-disc list-inside">
            <li>Use the <span className="text-zinc-300 font-medium">Rules</span> tab to manage groups and set time restrictions</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Home;
