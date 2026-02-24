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
    <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-transparent">
      <div className="flex-1" />
      <footer>
        <div className="px-6 pb-4 pt-3 text-center text-sm">
          <div className="mx-auto mb-3 h-px w-full max-w-xs bg-gradient-to-r from-transparent via-zinc-300/70 to-transparent dark:via-zinc-700/70" />
          <Link href="/privacy" className="text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
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
