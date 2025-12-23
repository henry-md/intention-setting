import { useState, useEffect, useCallback } from 'react';
import { checkPaymentStatus, createCheckoutSession } from '../utils/stripe';
import type { User } from '../types/User';

export const useStripe = (user: User | null, authLoading: boolean) => {
  const [paymentStatus, setPaymentStatus] = useState<'loading' | 'paid' | 'unpaid'>('loading');
  const [isProcessing, setIsProcessing] = useState(false); // Whether user is in process of upgrading on Stripe

  const checkUserPaymentStatus = useCallback(async () => {
    if (!user) return;
    
    // We are sure auth is loaded and we have a user, so start the check.
    setPaymentStatus('loading');
    try {
      const hasPaid = await checkPaymentStatus(user.uid);
      setPaymentStatus(hasPaid ? 'paid' : 'unpaid');
    } catch (error) {
      console.error('Error checking payment status:', error);
      setPaymentStatus('unpaid');
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

  return { paymentStatus, isProcessing, handleUpgrade };
};