'use client';

import PublicStatsPageClient from '@/components/PublicStatsPageClient';
import { useParams } from 'next/navigation';

export default function PublicStatsSlugRoutePage() {
  const params = useParams();
  const shareId = params.shareId as string;

  return <PublicStatsPageClient shareId={shareId} />;
}
