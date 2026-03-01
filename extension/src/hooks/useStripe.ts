import { useState, useEffect, useCallback } from 'react';
import {
  checkPaymentStatus,
  createCheckoutSession,
  getActiveSubscription,
  cancelSubscriptionAtPeriodEnd,
  superCancelSubscriptionForDebug,
  type StripeSubscription
} from '../utils/stripe';
import type { User } from '../types/User';

export const useStripe = (user: User | null, authLoading: boolean) => {
  const [paymentStatus, setPaymentStatus] = useState<'loading' | 'paid' | 'unpaid'>('loading');
  const [isProcessing, setIsProcessing] = useState(false); // Whether user is in process of upgrading on Stripe
  const [isCancelling, setIsCancelling] = useState(false);
  const [isSuperCancelling, setIsSuperCancelling] = useState(false);
  const [subscription, setSubscription] = useState<StripeSubscription | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const checkUserPaymentStatus = useCallback(async () => {
    if (!user) return;
    
    // We are sure auth is loaded and we have a user, so start the check.
    setPaymentStatus('loading');
    try {
      const [hasPaid, activeSubscription] = await Promise.all([
        checkPaymentStatus(user.uid),
        getActiveSubscription(user.uid)
      ]);
      setPaymentStatus(hasPaid ? 'paid' : 'unpaid');
      setSubscription(activeSubscription);
    } catch (error) {
      console.error('Error checking payment status:', error);
      setPaymentStatus('unpaid');
      setSubscription(null);
    }
  }, [user]);

  useEffect(() => {
    // Wait until the initial auth check is complete.
    if (authLoading) {
      return;
    }
    
    if (user) {
      checkUserPaymentStatus();
    } else {
      // If auth is done and there's no user, they are unpaid.
      setPaymentStatus('unpaid');
      setSubscription(null);
      setCancelError(null);
    }
  }, [user, authLoading, checkUserPaymentStatus]);

  const handleUpgrade = async () => {
    if (!user) return;
    
    setIsProcessing(true);
    try {
      const checkoutUrl = await createCheckoutSession(user.uid, user.email);
      
      chrome.tabs.create({ url: checkoutUrl });
      
      const handleTabUpdate = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
        if (changeInfo.url && (changeInfo.url.includes('success') || changeInfo.url.includes('cancel'))) {
          setTimeout(() => {
            checkUserPaymentStatus();
          }, 2000);
          chrome.tabs.onUpdated.removeListener(handleTabUpdate);
        }
      };
      
      chrome.tabs.onUpdated.addListener(handleTabUpdate);
      
    } catch (error) {
      console.error('Error creating checkout session:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelSubscription = async () => {
    if (!user) return;

    setIsCancelling(true);
    setCancelError(null);
    try {
      const updatedSubscription = await cancelSubscriptionAtPeriodEnd(user.uid);
      setSubscription(updatedSubscription);
    } catch (error) {
      console.error('Error canceling subscription:', error);
      const message = error instanceof Error ? error.message : 'Could not cancel subscription';
      setCancelError(message);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleSuperCancelSubscription = async () => {
    if (!user) return;

    setIsSuperCancelling(true);
    setCancelError(null);
    try {
      await superCancelSubscriptionForDebug(user.uid);
      await checkUserPaymentStatus();
    } catch (error) {
      console.error('Error super-canceling subscription:', error);
      const message = error instanceof Error ? error.message : 'Could not super-cancel subscription';
      setCancelError(message);
    } finally {
      setIsSuperCancelling(false);
    }
  };

  return {
    paymentStatus,
    isProcessing,
    isCancelling,
    isSuperCancelling,
    subscription,
    cancelError,
    handleUpgrade,
    handleCancelSubscription,
    handleSuperCancelSubscription
  };
};
