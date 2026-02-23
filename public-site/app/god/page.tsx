'use client';

import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

function GodContent() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!user) {
      return;
    }

    if (user.email !== 'henrymdeutsch@gmail.com') {
      router.replace('/stats');
    }
  }, [user, router]);

  if (user?.email !== 'henrymdeutsch@gmail.com') {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-black">
      <div className="flex-1" />
      <footer className="border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="px-6 py-4 text-center text-sm">
          <Link href="/privacy" className="text-blue-600 hover:text-blue-500 dark:text-blue-400">
            Privacy Policy
          </Link>
        </div>
      </footer>
    </div>
  );
}

export default function GodPage() {
  return (
    <ProtectedRoute>
      <GodContent />
    </ProtectedRoute>
  );
}
