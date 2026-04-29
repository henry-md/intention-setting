// src/utils/stripe.ts
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  onSnapshot,
  deleteDoc,
} from 'firebase/firestore';
import { auth, db, firebaseConfig } from './firebase';
// Firebase auth types imported on demand to avoid unused imports
import { FirebaseError } from 'firebase/app';
import { getFirebaseIdToken } from './firebaseIdToken';

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
const STRIPE_FUNCTIONS_REGION = 'us-central1';

export interface StripeSubscription {
  id: string;
  status?: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd?: number;
}

interface UpdateSubscriptionResponse {
  subscription?: ServerSubscription | null;
  error?: {
    message?: string;
  };
}

interface ServerSubscription {
  id?: string;
  status?: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: number | null;
}

interface GetSubscriptionResponse {
  subscription?: ServerSubscription | null;
  error?: {
    message?: string;
  };
}

function getCancelSubscriptionUrl(): string {
  return `https://${STRIPE_FUNCTIONS_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/cancelStripeSubscription`;
}

function getResumeSubscriptionUrl(): string {
  return `https://${STRIPE_FUNCTIONS_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/resumeStripeSubscription`;
}

function getSubscriptionStatusUrl(): string {
  return `https://${STRIPE_FUNCTIONS_REGION}-${firebaseConfig.projectId}.cloudfunctions.net/getStripeSubscription`;
}

function normalizeSubscriptionResponse(subscription: ServerSubscription): StripeSubscription {
  if (!subscription.id) {
    throw new Error('Subscription response was missing a subscription ID');
  }

  return {
    id: subscription.id,
    status: subscription.status,
    cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
    currentPeriodEnd:
      typeof subscription.currentPeriodEnd === 'number' ? subscription.currentPeriodEnd : undefined
  };
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

  await auth.authStateReady();

  // Check if Firebase Auth is already set up correctly
  const currentUser = auth.currentUser;
  if (currentUser && currentUser.uid === expectedUserId) {
    return; // Already authenticated with the correct user
  }

  throw new Error('Firebase authentication needs to be refreshed. Please sign out and sign back in.');
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
  const idToken = await getFirebaseIdToken(userId);
  const response = await fetch(getSubscriptionStatusUrl(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  const data = await response.json().catch(() => null) as GetSubscriptionResponse | null;

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Authentication expired. Please sign out and sign back in.');
    }

    throw new Error(data?.error?.message || `Could not load subscription (${response.status})`);
  }

  if (!data?.subscription) {
    return null;
  }

  return normalizeSubscriptionResponse(data.subscription);
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

  const idToken = await getFirebaseIdToken(userId);
  const response = await fetch(getCancelSubscriptionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      subscriptionId: subscription.id,
    }),
  });
  const data = await response.json().catch(() => null) as UpdateSubscriptionResponse | null;

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Authentication expired. Please sign out and sign back in.');
    }

    if (response.status === 503) {
      throw new Error('Stripe cancellation is not configured yet. Check the Firebase Stripe secret and redeploy.');
    }

    throw new Error(data?.error?.message || `Could not cancel subscription (${response.status})`);
  }

  if (!data?.subscription) {
    throw new Error('Cancel subscription returned an unexpected response.');
  }

  return normalizeSubscriptionResponse(data.subscription);
}

/**
 * Resume a subscription that was scheduled to cancel at period end.
 */
export async function resumeSubscription(userId: string): Promise<StripeSubscription> {
  const subscription = await getActiveSubscription(userId);

  if (!subscription) {
    throw new Error('No active subscription found');
  }

  if (!subscription.cancelAtPeriodEnd) {
    return subscription;
  }

  const idToken = await getFirebaseIdToken(userId);
  const response = await fetch(getResumeSubscriptionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      subscriptionId: subscription.id,
    }),
  });
  const data = await response.json().catch(() => null) as UpdateSubscriptionResponse | null;

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Authentication expired. Please sign out and sign back in.');
    }

    if (response.status === 503) {
      throw new Error('Stripe resume is not configured yet. Check the Firebase Stripe secret and redeploy.');
    }

    throw new Error(data?.error?.message || `Could not resume subscription (${response.status})`);
  }

  if (!data?.subscription) {
    throw new Error('Resume subscription returned an unexpected response.');
  }

  return normalizeSubscriptionResponse(data.subscription);
}

/**
 * Debug-only helper that removes subscription/payment records for a user.
 * This is for local testing and should never be exposed in production UI.
 */
export async function superCancelSubscriptionForDebug(userId: string): Promise<void> {
  await ensureFirebaseAuth(userId);

  // Best-effort: if a cancellable subscription exists, schedule cancel first.
  try {
    await cancelSubscriptionAtPeriodEnd(userId);
  } catch (error) {
    console.warn('Could not schedule cancellation before debug purge:', error);
  }

  const subscriptionsRef = collection(db, 'customers', userId, 'subscriptions');
  const nestedPaymentsRef = collection(db, 'customers', userId, 'payments');
  const rootPaymentsRef = collection(db, 'payments');

  const [subscriptionSnapshot, nestedPaymentSnapshot, rootPaymentSnapshot] = await Promise.all([
    getDocs(subscriptionsRef),
    getDocs(nestedPaymentsRef),
    getDocs(query(rootPaymentsRef, where('customer', '==', userId)))
  ]);

  const deleteTasks: Array<Promise<void>> = [];
  for (const subscriptionDoc of subscriptionSnapshot.docs) {
    deleteTasks.push(deleteDoc(subscriptionDoc.ref));
  }
  for (const paymentDoc of nestedPaymentSnapshot.docs) {
    deleteTasks.push(deleteDoc(paymentDoc.ref));
  }
  for (const paymentDoc of rootPaymentSnapshot.docs) {
    deleteTasks.push(deleteDoc(paymentDoc.ref));
  }

  await Promise.all(deleteTasks);
}
