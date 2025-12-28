import React from 'react';
import useAuth from '../hooks/useAuth';
import { useStripe } from '../hooks/useStripe';

interface AccountProps {
  onBack: () => void;
}

/**
 * Full-page account settings view. Child of Popup.tsx, accessed from profile button in Home tab.
 * NOT a tab - replaces entire view with back button. Sibling to GroupEdit.tsx (another full-page view).
 * Handles authentication and Stripe subscription management.
 */
const Account: React.FC<AccountProps> = ({ onBack }) => {
  const { user, loading: authLoading, handleSignIn, handleSignOut } = useAuth();
  const { paymentStatus, isProcessing, handleUpgrade } = useStripe(user, authLoading);

  if (authLoading) {
    return <div className="h-screen w-full flex items-center justify-center">Loading...</div>;
  }

  // Handle the case where the user is not signed in
  if (!user) {
    return (
      <div className="h-screen w-full p-6 flex flex-col">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-4">Boilerplate Chrome Extension</h2>
          <button onClick={handleSignIn} className="purple-button">
            Sign In with Google
          </button>
        </div>
      </div>
    );
  }

  // Account view for signed-in users
  return (
    <div className="h-screen w-full flex flex-col space-y-4 p-4">
      {/* Header with back button and title */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="purple-button">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" className="h-4 w-4" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h3 className="text-lg font-semibold absolute left-1/2 -translate-x-1/2">Account</h3>
        <div className="w-[40px]"></div>
      </div>

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

export default Account;
