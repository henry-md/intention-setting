import { normalizeHostname } from '../utils/urlNormalization';

export interface SiteExperience {
  siteKey: string;
  messagesUrl: string;
  isRootVisit(url: URL): boolean;
  isMessagesVisit(url: URL): boolean;
}

const SOCIAL_SITE_EXPERIENCES: SiteExperience[] = [
  {
    siteKey: 'instagram.com',
    messagesUrl: 'https://www.instagram.com/direct/inbox/',
    isRootVisit: (url) => url.pathname === '/',
    isMessagesVisit: (url) => url.pathname === '/direct' || url.pathname.startsWith('/direct/'),
  },
  {
    siteKey: 'tiktok.com',
    messagesUrl: 'https://www.tiktok.com/messages',
    isRootVisit: (url) => url.pathname === '/',
    isMessagesVisit: (url) => url.pathname === '/messages' || url.pathname.startsWith('/messages/'),
  },
];

function getExperience(url: URL): SiteExperience | undefined {
  const siteKey = normalizeHostname(url.hostname);
  return SOCIAL_SITE_EXPERIENCES.find((experience) => experience.siteKey === siteKey);
}

export function getMessagesRedirect(urlValue: string): string | null {
  try {
    const url = new URL(urlValue);
    const experience = getExperience(url);
    return experience?.isRootVisit(url) ? experience.messagesUrl : null;
  } catch {
    return null;
  }
}

export function isDirectMessageUrl(urlValue: string | undefined): boolean {
  if (!urlValue) return false;

  try {
    const url = new URL(urlValue);
    return getExperience(url)?.isMessagesVisit(url) ?? false;
  } catch {
    return false;
  }
}

export function getHomeUrlForMessages(urlValue: string): string | null {
  try {
    const url = new URL(urlValue);
    return getExperience(url)?.isMessagesVisit(url) ? `${url.origin}/` : null;
  } catch {
    return null;
  }
}
