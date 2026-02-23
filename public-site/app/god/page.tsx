'use client';

import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthContext';
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

  return <div className="min-h-screen bg-zinc-50 dark:bg-black" />;
}

export default function GodPage() {
  return (
    <ProtectedRoute>
      <GodContent />
    </ProtectedRoute>
  );
}
