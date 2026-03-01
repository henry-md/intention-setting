// src/utils/stripe.ts
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  onSnapshot,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from './firebase';
// Firebase auth types imported on demand to avoid unused imports
import { FirebaseError } from 'firebase/app';

// Test flags
const TEST_FLAG = import.meta.env.VITE_TEST_FLAG as string === 'true';
const TEST_FLAG_PREMIUM = import.meta.env.VITE_TEST_FLAG_PREMIUM as string === 'true';

// Firebase
const FIREBASE_HOSTING_URL = import.meta.env.VITE_FIREBASE_HOSTING_URL as string;

// Premium subscription
const PREMIUM_PRICE_ID = import.meta.env.VITE_PREMIUM_STRIPE_PRICE_ID as string;
const PREMIUM_PRICE_TYPE = import.meta.env.VITE_PREMIUM_PRICE_TYPE as string;
const PREMIUM_ITEM_DESCRIPTION = import.meta.env.VITE_PREMIUM_ITEM_DESCRIPTION as string;
const PREMIUM_SUCCESS_URL = `${FIREBASE_HOSTING_URL}/payment-success.html`;
const PREMIUM_CANCEL_URL = `${FIREBASE_HOSTING_URL}/payment-cancel.html`;

const CANCELLABLE_SUBSCRIPTION_STATUSES = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid'
]);

export interface StripeSubscription {
  id: string;
  status?: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd?: number;
}

/**
 * Ensures Firebase Auth context is properly set by using the stored access token
 */
async function ensureFirebaseAuth(expectedUserId: string): Promise<void> {
  // Get stored user data from Chrome storage
  const storedUser = await new Promise<{ uid: string; accessToken?: string } | null>((resolve) => {
    chrome.storage.local.get(['user'], (result) => {
      resolve(result.user);
    });
  });

  if (!storedUser || storedUser.uid !== expectedUserId) {
    throw new Error('User not authenticated or UID mismatch');
  }

  // Check if Firebase Auth is already set up correctly
  const currentUser = auth.currentUser;
  if (currentUser && currentUser.uid === expectedUserId) {
    return; // Already authenticated with the correct user
  }

  // Try to restore the Firebase Auth context using the stored access token
  if (storedUser.accessToken) {
    try {
      // Create a credential from the stored access token
      const { GoogleAuthProvider, signInWithCredential } = await import('firebase/auth/web-extension');
      const credential = GoogleAuthProvider.credential(null, storedUser.accessToken);
      await signInWithCredential(auth, credential);
    } catch (authError) {
      console.warn('Could not restore Firebase Auth context:', authError);
      // If we can't restore auth context, we'll proceed anyway as Firestore might still work
      // This can happen if the access token has expired
    }
  }
}

/**
 * Check if user has completed payment for premium features. Note that we 
 * check (1) in customers/{userId}/payments and (2) in root payments 
 * collection for defensive programming, but either should be sufficient.
 */
export async function checkPaymentStatus(userId: string): Promise<boolean> {
  try {
    console.log('Checking payment status for userId:', userId);

    // For Chrome extensions, we need to ensure Firebase Auth context is properly set
    // by getting a fresh auth token from the background script
    await ensureFirebaseAuth(userId);

    // Now proceed with queries - Firebase Auth context is properly set
    const nestedPaymentsRef = collection(db, 'customers', userId, 'payments');
    const rootPaymentsRef = collection(db, 'payments');

    const nestedQuery = getDocs(nestedPaymentsRef);
    const rootQueryTask = getDocs(query(rootPaymentsRef, where('customer', '==', userId)));

    // Run queries in parallel for better performance
    const [nestedSnapshot, rootSnapshot] = await Promise.all([nestedQuery, rootQueryTask]);

    const allPaymentDocs = [...nestedSnapshot.docs, ...rootSnapshot.docs];
    console.log(`Found ${nestedSnapshot.size} nested and ${rootSnapshot.size} root payments. Total: ${allPaymentDocs.length}`);

    // Validate any of the found documents against a single, consistent rule
    for (const doc of allPaymentDocs) {
      const paymentData = doc.data();

      // Can reference paymentData.amount or .currency for more strict validation
      let premiumPurchaseExpectedAmount = 100; // In cents
      if (TEST_FLAG) {
        premiumPurchaseExpectedAmount = TEST_FLAG_PREMIUM ? 0 : Math.pow(10, 6);
      }
      const isValid = (paymentData.status === 'succeeded' && parseInt(paymentData.amount) >= premiumPurchaseExpectedAmount); // paymentData.amount is cents

      if (isValid) {
        console.log('A valid payment was found.', { docId: doc.id, ...paymentData });
        return true;
      }
    }

    console.log('No valid payments found');
    return false;

  } catch (error) {
    console.error('Error checking payment status:', error);
    if (error instanceof FirebaseError && error.code === 'permission-denied') {
      console.log('Permission denied when checking payments');
      return false;
    }
    throw error;
  }
}

/**
 * Create a Stripe checkout session for premium upgrade
 */
export async function createCheckoutSession(userId: string, userEmail: string): Promise<string> {
  try {
    // For Chrome extensions, we need to ensure Firebase Auth context is properly set
    // by getting a fresh auth token from the background script
    await ensureFirebaseAuth(userId);

    const checkoutSessionRef = collection(
      db,
      'customers',
      userId,
      'checkout_sessions'
    );

    if (!PREMIUM_PRICE_ID) {
      throw new Error('VITE_STRIPE_PRICE_ID is not set');
    }
    if (!PREMIUM_SUCCESS_URL || !PREMIUM_CANCEL_URL) {
      throw new Error('VITE_PREMIUM_SUCCESS_URL or VITE_PREMIUM_CANCEL_URL is not set');
    }

    const sessionData = {
      price: PREMIUM_PRICE_ID,
      success_url: PREMIUM_SUCCESS_URL,
      cancel_url: PREMIUM_CANCEL_URL,
      mode: PREMIUM_PRICE_TYPE,
      metadata: {
        userId: userId,
        userEmail: userEmail,
        product: PREMIUM_ITEM_DESCRIPTION
      }
    };

    console.log('[Stripe] Creating checkout session with URLs:', {
      success_url: PREMIUM_SUCCESS_URL,
      cancel_url: PREMIUM_CANCEL_URL,
      firebase_hosting_url: FIREBASE_HOSTING_URL
    });
    const docRef = await addDoc(checkoutSessionRef, sessionData);
    console.log('Checkout session created:', docRef.id);

    // Wait for the checkout session URL to be generated
    return new Promise((resolve, reject) => {
      const unsubscribe = onSnapshot(docRef, (snap) => {
        const data = snap.data();
        console.log('Session data:', data);

        if (data?.error) {
          console.error('Checkout error:', data.error);
          unsubscribe();
          reject(new Error(data.error.message || 'Checkout session creation failed'));
        }

        if (data?.url) {
          console.log('Payment URL available:', data.url);
          unsubscribe();
          resolve(data.url);
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        unsubscribe();
        reject(new Error('Timeout waiting for checkout session'));
      }, 30000);
    });

  } catch (error) {
    console.error('Error creating checkout session:', error);
    throw error;
  }
}

/**
 * Return the user's most relevant active subscription, if present.
 */
export async function getActiveSubscription(userId: string): Promise<StripeSubscription | null> {
  await ensureFirebaseAuth(userId);

  const subscriptionsRef = collection(db, 'customers', userId, 'subscriptions');
  const snapshot = await getDocs(subscriptionsRef);

  const subscriptions: StripeSubscription[] = snapshot.docs
    .map((subscriptionDoc) => {
      const data = subscriptionDoc.data();
      return {
        id: subscriptionDoc.id,
        status: typeof data.status === 'string' ? data.status : undefined,
        cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
        currentPeriodEnd:
          typeof data.current_period_end === 'number' ? data.current_period_end : undefined
      };
    })
    .filter((subscription) => {
      if (!subscription.status) return false;
      return CANCELLABLE_SUBSCRIPTION_STATUSES.has(subscription.status);
    });

  if (!subscriptions.length) {
    return null;
  }

  subscriptions.sort((a, b) => (b.currentPeriodEnd ?? 0) - (a.currentPeriodEnd ?? 0));
  return subscriptions[0];
}

/**
 * Schedule subscription cancellation at period end for the active subscription.
 */
export async function cancelSubscriptionAtPeriodEnd(userId: string): Promise<StripeSubscription> {
  const subscription = await getActiveSubscription(userId);

  if (!subscription) {
    throw new Error('No active subscription found');
  }

  if (subscription.cancelAtPeriodEnd) {
    return subscription;
  }

  const subscriptionRef = doc(db, 'customers', userId, 'subscriptions', subscription.id);
  await updateDoc(subscriptionRef, {
    cancel_at_period_end: true
  });

  return {
    ...subscription,
    cancelAtPeriodEnd: true
  };
}
