'use client';

import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import Image from 'next/image';

export default function Home() {
  const { user, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
        <div className="text-lg text-zinc-600 dark:text-zinc-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <div className="w-full flex justify-between items-center mb-8">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            Intention Setter
          </h1>
          {user && (
            <button
              onClick={signOut}
              className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Sign Out
            </button>
          )}
        </div>

        {user ? (
          <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left flex-1">
            <div className="flex items-center gap-4">
              {user.photoURL && (
                <Image
                  src={user.photoURL}
                  alt="Profile"
                  width={64}
                  height={64}
                  className="rounded-full"
                />
              )}
              <div>
                <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                  Welcome, {user.displayName || 'User'}!
                </h2>
                <p className="text-zinc-600 dark:text-zinc-400">{user.email}</p>
              </div>
            </div>
            <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
              You are successfully signed in with Google OAuth! This is a demonstration of
              Firebase Authentication integration in a Next.js app.
            </p>
            <div className="mt-4 p-4 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
              <h3 className="font-semibold mb-2 text-zinc-900 dark:text-zinc-50">User Details:</h3>
              <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
                <li>UID: {user.uid}</li>
                <li>Email Verified: {user.emailVerified ? 'Yes' : 'No'}</li>
                <li>Provider: Google</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left flex-1">
            <h2 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
              Get started with Google OAuth
            </h2>
            <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
              This Next.js app demonstrates Firebase Authentication with Google OAuth.
              Sign in to see your profile information.
            </p>
            <Link
              href="/login"
              className="flex h-12 items-center justify-center gap-2 rounded-full bg-zinc-900 px-8 text-zinc-50 transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Sign in with Google
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
