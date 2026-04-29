import { NextResponse } from 'next/server';
import { getExtensionClientMessages } from '@/lib/extensionVersion';

export const dynamic = 'force-dynamic';

const responseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store, max-age=0',
};

export function GET() {
  const {
    latestVersion,
    minSupportedVersion,
    storeUrl,
    upgradeMessage,
  } = getExtensionClientMessages();

  return NextResponse.json({
    latestVersion,
    minSupportedVersion,
    storeUrl,
    message: upgradeMessage,
  }, {
    headers: responseHeaders,
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: responseHeaders,
  });
}
