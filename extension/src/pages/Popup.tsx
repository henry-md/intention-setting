import React, { useState } from 'react';
import useAuth from '../hooks/useAuth';
import { useStripe } from '../hooks/useStripe'; // Import the new hook
import Settings from './Settings';

const Popup: React.FC = () => {
  const { user, loading: authLoading, handleSignIn, handleSignOut } = useAuth();
  const { paymentStatus, isProcessing, handleUpgrade } = useStripe(user, authLoading);
  const [showSettings, setShowSettings] = useState(false);

  if (authLoading) {
    return <div className="p-4 text-center">Loading ...</div>;
  }

  if (showSettings) {
    return <Settings onBack={() => setShowSettings(false)} user={user} />;
  }

  // Handle the case where the user is not signed in
  if (!user) {
    return (
      <div className="p-6 w-80">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-4">Boilerplate Chrome Extension</h2>
          <button onClick={handleSignIn} className="purple-button">
            Sign In with Google
          </button>
        </div>
      </div>
    );
  }

  // Main view for signed-in users
  return (
    <div className="p-4 w-80">
      <button
        onClick={() => setShowSettings(true)}
        aria-label="Settings"
        className="mb-4 purple-button"
      >
        {/* Gear Icon SVG */}
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      <div className="flex flex-col space-y-4">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-2">Boilerplate Chrome Extension</h2>
          <p className="text-sm text-gray-600">Signed in as: {user.email}</p>
        </div>

        {paymentStatus === 'loading' && <div className="text-sm text-gray-600">Checking payment status...</div>}
        {paymentStatus === 'paid' && <div className="text-sm text-gray-600">Premium Active</div>}
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
    </div>
  );
};

export default Popup;
