// Avoid a build step by using the CDN
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';

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

const app = initializeApp(firebaseConfig);
const auth = getAuth();

// This gives you a reference to the parent frame, i.e. the offscreen document.
const PARENT_FRAME = document.location.ancestorOrigins[0];

const PROVIDER = new GoogleAuthProvider();

function sendResponse(result) {
  window.parent.postMessage(JSON.stringify(result), PARENT_FRAME);
}

window.addEventListener('message', function({data}) {
  if (data.initAuth) {
    signInWithPopup(auth, PROVIDER)
      .then(sendResponse)
      .catch(sendResponse);
  }
});