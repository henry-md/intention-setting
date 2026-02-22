# Google OAuth Setup for Next.js App

This Next.js application now has Google OAuth authentication fully integrated using Firebase Auth.

## What Was Added

### 1. Firebase Configuration (`lib/firebase.ts`)
- Initialized Firebase with the same configuration used by the Chrome extension and web OAuth flow
- Uses the `intention-setter` Firebase project
- Exports `auth` and `db` instances for use throughout the app

### 2. Authentication Context (`contexts/AuthContext.tsx`)
- Client-side React context for managing authentication state
- Provides:
  - `user`: Current authenticated user object
  - `loading`: Loading state while checking authentication
  - `signInWithGoogle()`: Function to initiate Google sign-in
  - `signOut()`: Function to sign out the current user
- Uses Firebase's `onAuthStateChanged` to automatically track auth state

### 3. Pages

#### Home Page (`app/page.tsx`)
- Shows different content based on authentication status
- Displays user profile info (name, email, photo) when logged in
- Shows "Sign in with Google" button when logged out

#### Login Page (`app/login/page.tsx`)
- Dedicated sign-in page with Google OAuth button
- Includes Google logo and branded design
- Automatically redirects to home page after successful login

#### Dashboard Page (`app/dashboard/page.tsx`)
- Protected route example - only accessible when authenticated
- Demonstrates protected content
- Shows how to build authenticated-only features

### 4. Protected Route Component (`components/ProtectedRoute.tsx`)
- Reusable wrapper component for protecting pages
- Automatically redirects unauthenticated users to `/login`
- Shows loading state while checking authentication
- Usage: Wrap any page component with `<ProtectedRoute>` to make it require authentication

### 5. Layout Updates (`app/layout.tsx`)
- Wrapped entire app with `<AuthProvider>` to make auth state available everywhere
- Updated metadata to reflect "Intention Setter" branding

## How to Test

### 1. Start the Development Server
```bash
cd public-site
npm run dev
```

### 2. Test the Authentication Flow

1. **Visit the Home Page** (`http://localhost:3000`)
   - Should show "Sign in with Google" button when not authenticated

2. **Click "Sign in with Google"** or go to `/login`
   - Will redirect to Google OAuth consent screen
   - Sign in with your Google account
   - Grant permissions

3. **After Sign In**
   - Should redirect back to home page
   - Will display your Google profile info (name, email, photo, UID)
   - User data is now available throughout the app via `useAuth()` hook

4. **Visit the Dashboard** (`/dashboard`)
   - Only accessible when authenticated
   - Shows protected content
   - Has navigation and sign-out button

5. **Sign Out**
   - Click the "Sign Out" button
   - Should return to unauthenticated state

### 3. Test Protected Routes

Try visiting `/dashboard` while logged out:
- Should automatically redirect to `/login`
- After logging in, can access the dashboard

## Architecture Notes

### Client vs Server Components
- The app uses Next.js App Router
- Authentication context is a **client component** (`'use client'` directive)
- All auth-related components must be client components
- This is correct for Next.js 13+ with Firebase

### Firebase Auth Integration
- Uses `signInWithPopup` for Google authentication
- This works in Next.js web apps (different from the Chrome extension's offscreen document pattern)
- Auth state persists across page refreshes via Firebase's built-in session management
- Compatible with Manifest V3 CSP restrictions mentioned in the project guidelines

### Security
- Firebase config is intentionally public (contains only project identifiers)
- Auth domain and API key are safe to expose client-side
- Actual security is enforced by Firebase's server-side rules
- For production, configure Firebase Security Rules in the Firebase Console

## Next Steps

1. **Add Firebase Security Rules**
   - Configure Firestore security rules in Firebase Console
   - Restrict read/write access based on authentication

2. **Add More Features**
   - User profile management
   - Store user data in Firestore
   - Add more OAuth providers (GitHub, Microsoft, etc.)

3. **Environment Variables** (Optional)
   - Move Firebase config to `.env.local` if you want to use different configs for dev/prod
   - Use `process.env.NEXT_PUBLIC_*` for client-side env vars

4. **Deployment**
   - Build: `npm run build`
   - The app is ready to deploy to Vercel, Netlify, or any other Next.js hosting platform
   - Ensure Firebase authorized domains include your production domain

## Using the Auth Context in Your Components

```tsx
'use client';

import { useAuth } from '@/contexts/AuthContext';

export default function MyComponent() {
  const { user, loading, signInWithGoogle, signOut } = useAuth();

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return (
      <button onClick={signInWithGoogle}>
        Sign In
      </button>
    );
  }

  return (
    <div>
      <p>Welcome, {user.displayName}!</p>
      <button onClick={signOut}>Sign Out</button>
    </div>
  );
}
```

## Files Created

- `lib/firebase.ts` - Firebase initialization
- `contexts/AuthContext.tsx` - Authentication context provider
- `components/ProtectedRoute.tsx` - Protected route wrapper
- `app/login/page.tsx` - Login page
- `app/dashboard/page.tsx` - Example protected page
- Modified: `app/layout.tsx` - Added AuthProvider
- Modified: `app/page.tsx` - Updated home page with auth UI

## Compatibility

✅ **Compatible with Manifest V3 CSP** - Uses standard Firebase web auth, not requiring inline scripts
✅ **Same Firebase project** - Uses the same `intention-setter` project as the extension and web OAuth
✅ **Next.js 16** - Built with latest Next.js App Router
✅ **TypeScript** - Fully typed with TypeScript
✅ **Tailwind CSS** - Styled with Tailwind CSS (matches existing design system)
