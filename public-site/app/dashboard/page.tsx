'use client';

import ProtectedRoute from '@/components/ProtectedRoute';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

function DashboardRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/stats');
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black">
      <div className="text-lg text-zinc-600 dark:text-zinc-400">Loading...</div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardRedirect />
    </ProtectedRoute>
  );
}
