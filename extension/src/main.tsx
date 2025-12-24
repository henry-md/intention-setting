import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Suppress harmless "Extension context invalidated" errors from HMR during extension reloads
// window.addEventListener('error', (event) => {
//   if (event.message?.includes('Extension context invalidated')) {
//     event.preventDefault();
//     event.stopPropagation();
//     return false;
//   }
// });

// // Also catch unhandled promise rejections
// window.addEventListener('unhandledrejection', (event) => {
//   if (event.reason?.message?.includes('Extension context invalidated')) {
//     event.preventDefault();
//     return false;
//   }
// });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
