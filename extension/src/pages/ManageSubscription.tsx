import React, { useState } from 'react';
import type { User } from '../types/User';
import { useStripe } from '../hooks/useStripe';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';

interface ManageSubscriptionProps {
  user: User | null;
  onBack: () => void;
}

const ManageSubscription: React.FC<ManageSubscriptionProps> = ({ user, onBack }) => {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false);
  const {
    paymentStatus,
    isCancelling,
    isResuming,
    subscription,
    subscriptionError,
    handleCancelSubscription,
    handleResumeSubscription,
  } = useStripe(user, false);

  const confirmCancellation = async () => {
    await handleCancelSubscription();
    setCancelDialogOpen(false);
  };

  const confirmResume = async () => {
    await handleResumeSubscription();
    setResumeDialogOpen(false);
  };

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

        {paymentStatus === 'paid' && subscription && (
          <>
            <p className="text-sm text-zinc-300">
              Plan status: <span className="font-medium text-zinc-100">Premium Active</span>
            </p>

            {subscription?.cancelAtPeriodEnd ? (
              <>
                <p className="text-xs text-amber-300">
                  Your subscription is already set to cancel at period end.
                </p>
                <button
                  onClick={() => setResumeDialogOpen(true)}
                  disabled={isResuming}
                  className="w-full px-4 py-2 border border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-70 text-emerald-100 font-medium rounded-lg transition-colors"
                >
                  {isResuming ? 'Resuming...' : 'Resume Subscription'}
                </button>
              </>
            ) : (
              <button
                onClick={() => setCancelDialogOpen(true)}
                disabled={isCancelling}
                className="w-full px-4 py-2 border border-red-500/70 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-70 text-red-100 font-medium rounded-lg transition-colors"
              >
                {isCancelling ? 'Cancelling...' : 'Cancel Subscription'}
              </button>
            )}

            <p className="text-xs text-zinc-500">
              Cancellation takes effect at the end of the current billing period.
            </p>
          </>
        )}

        {(paymentStatus === 'unpaid' || (paymentStatus === 'paid' && !subscription)) && (
          <p className="text-sm text-zinc-400">No active premium subscription to manage.</p>
        )}

        {subscriptionError && (
          <p className="text-xs text-red-300">{subscriptionError}</p>
        )}
      </div>

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="bg-zinc-800 border-zinc-600 text-white" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-white">Cancel Subscription?</DialogTitle>
            <DialogDescription className="text-zinc-300">
              Premium remains active until the end of your current billing period.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setCancelDialogOpen(false)}
              disabled={isCancelling}
              className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-70 text-white font-medium transition-colors"
            >
              Keep Subscription
            </button>
            <button
              type="button"
              onClick={confirmCancellation}
              disabled={isCancelling}
              className="px-4 py-2 rounded-lg border border-red-500/70 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-70 text-red-100 font-medium transition-colors"
            >
              {isCancelling ? 'Cancelling...' : 'Cancel at Period End'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resumeDialogOpen} onOpenChange={setResumeDialogOpen}>
        <DialogContent className="bg-zinc-800 border-zinc-600 text-white" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="text-white">Resume Subscription?</DialogTitle>
            <DialogDescription className="text-zinc-300">
              Your premium subscription will continue renewing on its existing billing schedule.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setResumeDialogOpen(false)}
              disabled={isResuming}
              className="px-4 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-70 text-white font-medium transition-colors"
            >
              Keep Cancellation
            </button>
            <button
              type="button"
              onClick={confirmResume}
              disabled={isResuming}
              className="px-4 py-2 rounded-lg border border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-70 text-emerald-100 font-medium transition-colors"
            >
              {isResuming ? 'Resuming...' : 'Resume Subscription'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ManageSubscription;
