// src/utils/firebase.ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth/web-extension';
import { getFirestore as getFirestoreLite } from 'firebase/firestore/lite';
import { getFirestore as getRealtimeFirestore } from 'firebase/firestore';

// TODO: Replace with your actual Firebase config after you've created Firebase web app
const firebaseConfig = {
  apiKey: "AIzaSyBhMuk48NTYKybqfFCxTwzoe0gucuD-tfs",
  authDomain: "intention-setter.firebaseapp.com",
  projectId: "intention-setter",
  storageBucket: "intention-setter.firebasestorage.app",
  messagingSenderId: "322831296302",
  appId: "1:322831296302:web:a1f73b457741e8c5d5fcbf",
  measurementId: "G-8Y5JMLNZ6X"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Auth for Web Extension
const auth = getAuth(app);
// The MV3 service worker has no XMLHttpRequest, so app/background reads and
// writes must use Firestore Lite (fetch-based). Keep a full client only for
// the small UI surface that needs a realtime listener.
const db = getFirestoreLite(app);
const realtimeDb = getRealtimeFirestore(app);

export { auth, db, realtimeDb, firebaseConfig };
