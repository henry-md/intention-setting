import React from 'react';
import type { User } from '../types/User';
import { useStripe } from '../hooks/useStripe';

interface ManageSubscriptionProps {
  user: User | null;
  onBack: () => void;
}

const ManageSubscription: React.FC<ManageSubscriptionProps> = ({ user, onBack }) => {
  const {
    paymentStatus,
    isCancelling,
    subscription,
    cancelError,
    handleCancelSubscription
  } = useStripe(user, false);

  if (!user) {
    return (
      <div className="h-full w-full p-6 flex items-center justify-center">
        <p className="text-sm text-zinc-400 text-center">
          Sign in from the Account tab to manage your subscription.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full w-full p-4">
      <div className="flex flex-col gap-3 bg-zinc-800 border border-zinc-600 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-zinc-100">Manage Subscription</h3>
          <button
            onClick={onBack}
            className="px-3 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100"
          >
            Back
          </button>
        </div>

        {paymentStatus === 'loading' && (
          <p className="text-sm text-zinc-400">Checking subscription status...</p>
        )}

        {paymentStatus === 'paid' && (
          <>
            <p className="text-sm text-zinc-300">
              Plan status: <span className="font-medium text-zinc-100">Premium Active</span>
            </p>

            {subscription?.cancelAtPeriodEnd ? (
              <p className="text-xs text-amber-300">
                Your subscription is already set to cancel at period end.
              </p>
            ) : (
              <button
                onClick={handleCancelSubscription}
                disabled={isCancelling}
                className="w-full px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-70 text-white font-medium rounded-lg transition-colors"
              >
                {isCancelling ? 'Cancelling...' : 'Cancel Subscription'}
              </button>
            )}

            <p className="text-xs text-zinc-500">
              Cancellation takes effect at the end of the current billing period.
            </p>
          </>
        )}

        {paymentStatus === 'unpaid' && (
          <p className="text-sm text-zinc-400">No active premium subscription to manage.</p>
        )}

        {cancelError && (
          <p className="text-xs text-red-300">{cancelError}</p>
        )}
      </div>
    </div>
  );
};

export default ManageSubscription;
