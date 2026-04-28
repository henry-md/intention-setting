import type { User } from '../types/User';
import { auth, firebaseConfig } from './firebase';

interface SecureTokenRefreshResponse {
  expires_in: string;
  id_token: string;
  refresh_token: string;
  user_id: string;
}

function getStoredUser(): Promise<User | null> {
  return new Promise(resolve => {
    chrome.storage.local.get(['user'], result => {
      resolve((result.user as User | undefined) || null);
    });
  });
}

function getStoredTokenExpiry(user: User): number {
  return Number(user.stsTokenManager?.expirationTime || 0);
}

function getStoredAccessToken(user: User): string | null {
  return user.stsTokenManager?.accessToken || user.accessToken || null;
}

async function refreshFirebaseIdToken(user: User): Promise<string> {
  const refreshToken = user.stsTokenManager?.refreshToken;

  if (!refreshToken) {
    throw new Error('Firebase refresh token is missing. Please sign out and sign back in.');
  }

  const response = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${firebaseConfig.apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    }
  );

  const data = (await response.json()) as Partial<SecureTokenRefreshResponse> & {
    error?: { message?: string };
  };

  if (!response.ok || !data.id_token || !data.refresh_token || !data.expires_in) {
    throw new Error(
      data.error?.message
        ? `Firebase token refresh failed: ${data.error.message}`
        : 'Firebase token refresh failed. Please sign out and sign back in.'
    );
  }

  const refreshedUser: User = {
    ...user,
    accessToken: data.id_token,
    stsTokenManager: {
      ...user.stsTokenManager,
      accessToken: data.id_token,
      refreshToken: data.refresh_token,
      expirationTime: String(Date.now() + Number(data.expires_in) * 1000),
    },
  };

  await new Promise<void>(resolve => {
    chrome.storage.local.set({ user: refreshedUser }, () => resolve());
  });

  return data.id_token;
}

export async function getFirebaseIdToken(expectedUserId: string): Promise<string> {
  const currentUser = auth.currentUser;
  if (currentUser && currentUser.uid === expectedUserId) {
    return currentUser.getIdToken();
  }

  const storedUser = await getStoredUser();

  if (!storedUser || storedUser.uid !== expectedUserId) {
    throw new Error('User not authenticated. Please sign in again.');
  }

  const storedAccessToken = getStoredAccessToken(storedUser);
  const expiry = getStoredTokenExpiry(storedUser);
  const refreshBufferMs = 60_000;

  if (storedAccessToken && expiry > Date.now() + refreshBufferMs) {
    return storedAccessToken;
  }

  if (storedUser.stsTokenManager?.refreshToken) {
    return refreshFirebaseIdToken(storedUser);
  }

  if (storedAccessToken) {
    return storedAccessToken;
  }

  throw new Error('Unable to retrieve a Firebase auth token. Please sign out and sign back in.');
}
