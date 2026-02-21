import React, { useState, useEffect } from 'react';
import type { User } from '../types/User';
import useAuth from '../hooks/useAuth';
import { useStripe } from '../hooks/useStripe';
import Spinner from '../components/Spinner';

interface HomeProps {
  user: User | null;
}

/**
 * Account tab - shows user authentication status, premium status, and account actions.
 * Child of Popup.tsx, renders inside the Account tab.
 * Also shows YouTube stop button when on YouTube.
 */
const Home: React.FC<HomeProps> = () => {
  const { user, loading: authLoading, handleSignIn, handleSignOut } = useAuth();
  const { paymentStatus, isProcessing, handleUpgrade } = useStripe(user, authLoading);
  const [isYouTube, setIsYouTube] = useState(false);

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

  if (authLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  // Handle the case where the user is not signed in
  if (!user) {
    return (
      <div className="h-screen w-full p-6 flex flex-col items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-4">Boilerplate Chrome Extension</h2>
          <button onClick={handleSignIn} className="purple-button">
            Sign In with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col space-y-4 p-4 overflow-y-auto">
      {/* Header with title */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Intention Setting</h3>
      </div>

      {/* Account Information */}
      <div className="flex flex-col space-y-3 bg-gray-800 border border-gray-600 rounded-lg p-4">
        <div className="text-center">
          <p className="text-sm text-gray-400 mb-1">Signed in as:</p>
          <p className="text-sm font-medium text-gray-200">{user.email}</p>
        </div>

        {paymentStatus === 'loading' && (
          <div className="text-sm text-gray-400 text-center">Checking payment status...</div>
        )}
        {paymentStatus === 'paid' && (
          <div className="text-sm text-green-400 text-center font-medium">Premium Active</div>
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

        {/* Info message about using Groups and Limits */}
        <div className="bg-gray-800 border border-gray-600 rounded-lg p-4">
          <p className="text-gray-300 text-sm mb-2">
            To manage URLs and time limits:
          </p>
          <ul className="text-gray-400 text-sm space-y-1 list-disc list-inside">
            <li>Use the <span className="text-blue-400 font-medium">Groups</span> tab to organize URLs</li>
            <li>Use the <span className="text-blue-400 font-medium">Limits</span> tab to set time restrictions</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Home;
