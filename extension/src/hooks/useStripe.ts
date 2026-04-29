import { useState, useEffect, useCallback } from 'react';
import {
  checkPaymentStatus,
  createCheckoutSession,
  getActiveSubscription,
  cancelSubscriptionAtPeriodEnd,
  resumeSubscription,
  type StripeSubscription
} from '../utils/stripe';
import type { User } from '../types/User';

export const useStripe = (user: User | null, authLoading: boolean) => {
  const [paymentStatus, setPaymentStatus] = useState<'loading' | 'paid' | 'unpaid'>('loading');
  const [isProcessing, setIsProcessing] = useState(false); // Whether user is in process of upgrading on Stripe
  const [isCancelling, setIsCancelling] = useState(false);
  const [isResuming, setIsResuming] = useState(false);
  const [subscription, setSubscription] = useState<StripeSubscription | null>(null);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);

  const checkUserPaymentStatus = useCallback(async () => {
    if (!user) return;
    
    // We are sure auth is loaded and we have a user, so start the check.
    setPaymentStatus('loading');
    try {
      const [paymentResult, subscriptionResult] = await Promise.allSettled([
        checkPaymentStatus(user.uid),
        getActiveSubscription(user.uid)
      ]);
      const activeSubscription =
        subscriptionResult.status === 'fulfilled' ? subscriptionResult.value : null;
      const hasPaid =
        (paymentResult.status === 'fulfilled' && paymentResult.value) ||
        Boolean(activeSubscription);

      setPaymentStatus(hasPaid ? 'paid' : 'unpaid');
      setSubscription(activeSubscription);

      if (paymentResult.status === 'rejected') {
        console.warn('Payment status check failed:', paymentResult.reason);
      }
      if (subscriptionResult.status === 'rejected') {
        console.warn('Subscription status check failed:', subscriptionResult.reason);
      }
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
      setSubscriptionError(null);
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
    setSubscriptionError(null);
    try {
      const updatedSubscription = await cancelSubscriptionAtPeriodEnd(user.uid);
      setSubscription(updatedSubscription);
    } catch (error) {
      console.error('Error canceling subscription:', error);
      const message = error instanceof Error ? error.message : 'Could not cancel subscription';
      setSubscriptionError(message);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleResumeSubscription = async () => {
    if (!user) return;

    setIsResuming(true);
    setSubscriptionError(null);
    try {
      const updatedSubscription = await resumeSubscription(user.uid);
      setSubscription(updatedSubscription);
    } catch (error) {
      console.error('Error resuming subscription:', error);
      const message = error instanceof Error ? error.message : 'Could not resume subscription';
      setSubscriptionError(message);
    } finally {
      setIsResuming(false);
    }
  };

  return {
    paymentStatus,
    isProcessing,
    isCancelling,
    isResuming,
    subscription,
    subscriptionError,
    handleUpgrade,
    handleCancelSubscription,
    handleResumeSubscription,
  };
};
