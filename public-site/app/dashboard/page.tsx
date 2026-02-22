'use client';

import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';

export default function DashboardPage() {
  const { user, signOut } = useAuth();

  return (
    <ProtectedRoute>
      <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
              Intention Setter
            </Link>
            <button
              onClick={signOut}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              Sign Out
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
          <h1 className="mb-4 text-3xl font-bold text-zinc-900 dark:text-zinc-50">
            Dashboard
          </h1>
          <p className="mb-8 text-lg text-zinc-600 dark:text-zinc-400">
            Welcome to your protected dashboard, {user?.displayName}!
          </p>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                Profile
              </h2>
              <p className="text-zinc-600 dark:text-zinc-400">
                View and edit your profile information
              </p>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                Settings
              </h2>
              <p className="text-zinc-600 dark:text-zinc-400">
                Manage your account settings and preferences
              </p>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="mb-2 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                Activity
              </h2>
              <p className="text-zinc-600 dark:text-zinc-400">
                View your recent activity and history
              </p>
            </div>
          </div>

          <div className="mt-8 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              Protected Content
            </h2>
            <p className="text-zinc-600 dark:text-zinc-400">
              This page is only accessible to authenticated users. The ProtectedRoute component
              automatically redirects unauthenticated users to the login page.
            </p>
          </div>
        </main>
      </div>
    </ProtectedRoute>
  );
}
