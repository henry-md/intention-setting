export const DEFAULT_DAILY_RESET_TIME = '04:00';
export const ALLOW_CUSTOM_RESET_TIME = true;

export const DEFAULT_UPCOMING_LIMIT_REMINDER_SECONDS = 10;
export const MIN_UPCOMING_LIMIT_REMINDER_SECONDS = 3;
export const MAX_UPCOMING_LIMIT_REMINDER_SECONDS = 60;

export const DEFAULT_TIMER_BADGE_WIDTH_SCALE = 0.65;
export const MIN_TIMER_BADGE_WIDTH_SCALE = 0.35;
export const MAX_TIMER_BADGE_WIDTH_SCALE = 1.2;

export const DEFAULT_TIMER_BADGE_TEXT_SCALE = 1;
export const MIN_TIMER_BADGE_TEXT_SCALE = 0.7;
export const MAX_TIMER_BADGE_TEXT_SCALE = 1.8;

export const TUTORIAL_STORAGE_KEY = 'ruleTutorialV1Status';
export const TUTORIAL_EXACT_PROMPT = 'Make a 20 minute soft limit with 5 1-minute extensions for all social media';
export const TUTORIAL_GROUP_NAME = 'Social Media';
export const TUTORIAL_RULE_NAME = 'Social Media Soft Limit';
export const TUTORIAL_SOCIAL_URLS = [
  'instagram.com',
  'facebook.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'reddit.com',
  'snapchat.com',
  'threads.net',
];

export const EXTENSION_UPDATE_PROMPT_STORAGE_KEY = 'extensionUpdatePromptLastShownAt';
export const EXTENSION_CLIENT_MESSAGE_SEEN_STORAGE_KEY = 'extensionClientMessageLastSeen';
export const EXTENSION_UPDATE_PROMPT_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const EXTENSION_VERSION_ENDPOINT_PATH = '/api/extension-version';
export const EXTENSION_CLIENT_MESSAGES_ENDPOINT_PATH = '/api/extension-client-messages';
export const COMPANION_WEB_APP_URL = 'https://intention-setting-production.up.railway.app';
export const DEFAULT_PUBLIC_SITE_URL = COMPANION_WEB_APP_URL;
