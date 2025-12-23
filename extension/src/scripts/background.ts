import "./firebase-config";
import { format } from 'date-fns';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../utils/firebase';

// Test imports
const testDate = new Date();
console.log('Hello from background.ts @', format(testDate, 'yyyy-MM-dd HH:mm:ss'));

// Listen for when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed/updated");
});

// Handle requests to close a success or cancel tab (tab created after Stripe payment)
chrome.runtime.onMessage.addListener((message, sender) => {
  console.log('Background message received:', message);

  if (message.action === 'close-success-tab' || message.action === 'close-cancel-tab') {
    if (sender.tab?.id) {
      chrome.tabs.remove(sender.tab.id);
    }
  }

  // Handle intention saving
  if (message.action === 'saveIntention') {
    const intentionData = {
      intention: message.intention,
      url: message.url,
      timestamp: message.timestamp,
      timeLimit: message.timeLimit
    };

    console.log('Intention saved:', intentionData);

    // Store intention in Chrome storage
    chrome.storage.local.get(['intentions', 'user'], async (result) => {
      const intentions = result.intentions || [];
      intentions.push(intentionData);

      chrome.storage.local.set({ intentions });
      console.log('Intentions stored in local storage:', intentions);

      // Also save to Firestore if user is logged in
      if (result.user?.uid) {
        try {
          const userDocRef = doc(db, 'users', result.user.uid);
          const { arrayUnion } = await import('firebase/firestore');

          await setDoc(userDocRef, {
            intentions: arrayUnion(intentionData)
          }, { merge: true });

          console.log('Intention saved to Firestore');
        } catch (error) {
          console.error('Error saving intention to Firestore:', error);
        }
      }
    });
  }

  // Handle time tracking updates to Firestore
  if (message.action === 'updateTimeTracking') {
    const { userId, siteKey, timeData } = message;

    console.log('Updating time tracking:', { userId, siteKey, timeData });

    // Update Firestore
    const userDocRef = doc(db, 'users', userId);

    setDoc(userDocRef, {
      timeTracking: {
        [siteKey]: timeData
      }
    }, { merge: true })
      .then(() => {
        console.log('Time tracking updated in Firestore');
      })
      .catch((error) => {
        console.error('Error updating time tracking:', error);
      });
  }
});
