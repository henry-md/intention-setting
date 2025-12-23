// src/utils/firebase.ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth/web-extension';
import { getFirestore } from 'firebase/firestore';

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
const db = getFirestore(app);

export { auth, db };