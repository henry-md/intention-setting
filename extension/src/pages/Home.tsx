import React, { useState, useEffect } from 'react';
import type { User } from '../types/User';

interface HomeProps {
  onShowAccount: () => void;
  user: User | null;
}

/**
 * Home tab - simplified to show YouTube stop button when on YouTube.
 * Child of Popup.tsx, renders inside the Home tab.
 * URL management has been moved to Groups and Limits.
 */
const Home: React.FC<HomeProps> = ({ onShowAccount }) => {
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
