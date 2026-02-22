import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase configuration - same as extension and web OAuth flow
const firebaseConfig = {
  apiKey: "AIzaSyBhMuk48NTYKybqfFCxTwzoe0gucuD-tfs",
  authDomain: "intention-setter.firebaseapp.com",
  projectId: "intention-setter",
  storageBucket: "intention-setter.firebasestorage.app",
  messagingSenderId: "322831296302",
  appId: "1:322831296302:web:a1f73b457741e8c5d5fcbf",
  measurementId: "G-8Y5JMLNZ6X"
};

// Initialize Firebase only if it hasn't been initialized yet
// This prevents "Firebase app already exists" errors during hot reloads
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
