export interface ProviderData {
  displayName: string;
  email: string;
  // May add other fields later (providerId, photoURL, etc.)
}

// Security Token Service Token Manager
export interface StsTokenManager {
  accessToken: string;
  expirationTime: string;
  refreshToken: string;
}

// Default user type from Firebase Google OAuth
export interface User {
  apiKey: string;
  appName: string;
  createdAt: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  isAnonymous: boolean;
  lastLoginAt: string;
  photoURL: string;
  providerData: ProviderData[];
  stsTokenManager: StsTokenManager;
  uid: string;
  // Disable excess property checking for object literals
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
