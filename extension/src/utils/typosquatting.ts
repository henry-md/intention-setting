/**
 * Typosquatting detection utility. Used by Home.tsx and GroupEdit.tsx to warn users
 * about potential phishing domains that are similar to popular sites.
 */

// Top ~200 most popular domains (without TLD)
const POPULAR_DOMAINS = [
  // Social Media
  'facebook', 'instagram', 'twitter', 'linkedin', 'tiktok', 'reddit', 'snapchat',
  'pinterest', 'tumblr', 'whatsapp', 'telegram', 'discord', 'mastodon', 'threads',

  // Search Engines
  'google', 'bing', 'yahoo', 'duckduckgo', 'yandex', 'baidu',

  // Video & Streaming
  'youtube', 'netflix', 'twitch', 'vimeo', 'dailymotion', 'hulu', 'disneyplus',
  'hbomax', 'primevideo', 'spotify', 'soundcloud', 'pandora',

  // E-commerce
  'amazon', 'ebay', 'alibaba', 'aliexpress', 'etsy', 'shopify', 'walmart',
  'target', 'bestbuy', 'craigslist', 'mercari', 'poshmark', 'depop',

  // Tech & Development
  'github', 'gitlab', 'stackoverflow', 'stackexchange', 'bitbucket', 'npmjs',
  'pypi', 'docker', 'kubernetes', 'apache', 'nginx', 'cloudflare', 'aws',
  'azure', 'vercel', 'netlify', 'heroku', 'digitalocean',

  // News & Media
  'cnn', 'bbc', 'nytimes', 'washingtonpost', 'theguardian', 'reuters',
  'bloomberg', 'forbes', 'techcrunch', 'wired', 'theverge', 'engadget',
  'huffpost', 'buzzfeed', 'medium', 'substack',

  // Email & Communication
  'gmail', 'outlook', 'protonmail', 'zoho', 'mailchimp', 'slack', 'zoom',
  'teams', 'skype', 'meet',

  // Education
  'wikipedia', 'wikihow', 'coursera', 'udemy', 'khanacademy', 'edx',
  'duolingo', 'quizlet', 'chegg', 'scribd', 'academia',

  // Finance & Crypto
  'paypal', 'venmo', 'cashapp', 'stripe', 'square', 'coinbase', 'binance',
  'kraken', 'blockchain', 'robinhood', 'webull', 'chase', 'bankofamerica',
  'wellsfargo', 'citibank',

  // Travel & Maps
  'google', 'maps', 'airbnb', 'booking', 'expedia', 'tripadvisor', 'uber',
  'lyft', 'doordash', 'grubhub', 'ubereats',

  // Gaming
  'steam', 'epicgames', 'roblox', 'minecraft', 'playstation', 'xbox',
  'nintendo', 'origin', 'battlenet', 'gog',

  // Productivity & Office
  'notion', 'trello', 'asana', 'monday', 'clickup', 'airtable', 'evernote',
  'dropbox', 'box', 'onedrive', 'drive', 'docs', 'sheets', 'slides',

  // Dating & Social
  'tinder', 'bumble', 'hinge', 'okcupid', 'match', 'meetup',

  // Other Popular Sites
  'wordpress', 'wix', 'squarespace', 'godaddy', 'namecheap', 'canva',
  'figma', 'adobe', 'photoshop', 'behance', 'dribbble', 'unsplash',
  'pexels', 'shutterstock', 'fiverr', 'upwork', 'freelancer',

  // International Sites
  'taobao', 'jd', 'weibo', 'vk', 'ok', 'line', 'kakao', 'naver',
  'rakuten', 'mercadolibre', 'flipkart', 'paytm',

  // News & Forums
  'quora', 'yelp', 'imdb', 'goodreads', 'letterboxd', 'myanimelist',
  'fandom', 'genius', 'urbandictionary',

  // Shopping & Deals
  'costco', 'samsclub', 'homedepot', 'lowes', 'ikea', 'wayfair', 'overstock',
  'zappos', 'nordstrom', 'macys', 'kohls',

  // Entertainment
  'imgur', 'giphy', 'deviantart', 'artstation', 'flickr', 'smugmug',

  // Adult (for legitimate blocking/tracking)
  'pornhub', 'brazzers', 'xvideos', 'xnxx', 'redtube', 'onlyfans', 'xhamster', 'youporn',
  'spankwire', 'tube8', 'keezmovies', 'tnaflix', 'sunporno', 'tubev', '4tube',
  'beeg', 'drtuber', 'thumbzilla', 'spankbang', 'xhamsterlive', 'livejasmin',
  'chaturbate', 'stripchat', 'myfreecams', 'camsoda', 'bongacams', 'manyvids',
  'pornmd', 'porn300', 'anyporn', 'watchmygf', '4porn', 'fapdu', 'tubegalore',

  // Business & Professional
  'salesforce', 'hubspot', 'zendesk', 'intercom', 'freshdesk', 'jira',
  'confluence', 'basecamp',

  // Government & Organizations
  'un', 'who', 'nasa', 'archives', 'archive',

  // Popular Brands
  'apple', 'microsoft', 'samsung', 'sony', 'dell', 'hp', 'lenovo', 'asus',
  'lg', 'intel', 'amd', 'nvidia', 'tesla', 'spacex',

  // Search & Discovery
  'pinterest', 'houzz', 'zillow', 'realtor', 'redfin', 'trulia',
];

/**
 * Calculate Levenshtein distance between two strings
 * Returns the minimum number of single-character edits needed to transform one string into another
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;

  // Create a 2D array for dynamic programming
  const dp: number[][] = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  // Initialize first row and column
  for (let i = 0; i <= len1; i++) dp[i][0] = i;
  for (let j = 0; j <= len2; j++) dp[0][j] = j;

  // Fill the dp table
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,     // deletion
          dp[i][j - 1] + 1,     // insertion
          dp[i - 1][j - 1] + 1  // substitution
        );
      }
    }
  }

  return dp[len1][len2];
}

/**
 * Extract the base domain name from a URL (without TLD)
 * Examples:
 * - "https://www.instagram.com" -> "instagram"
 * - "instsagram.com" -> "instsagram"
 * - "m.facebook.com" -> "facebook"
 */
function extractBaseDomain(url: string): string {
  try {
    // Remove protocol if present
    let domain = url.replace(/^https?:\/\//, '');

    // Remove www., m., mobile. prefixes
    domain = domain.replace(/^(www\.|m\.|mobile\.)/, '');

    // Split by dots and get the first part (before TLD)
    const parts = domain.split('.');

    // Return the base domain (first part before TLD)
    return parts[0].toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export interface TyposquattingCheckResult {
  isSuspicious: boolean;
  suggestion?: string;
  distance?: number;
}

/**
 * Check if a URL is potentially a typosquatting attempt
 * Returns a warning if the domain is 1-2 characters away from a popular domain
 */
export function checkTyposquatting(url: string): TyposquattingCheckResult {
  const baseDomain = extractBaseDomain(url);

  // Skip check for very short domains (likely intentional)
  if (baseDomain.length < 4) {
    return { isSuspicious: false };
  }

  let closestMatch: string | undefined;
  let smallestDistance = Infinity;

  for (const popularDomain of POPULAR_DOMAINS) {
    // Skip if exact match (it's the real site)
    if (baseDomain === popularDomain) {
      return { isSuspicious: false };
    }

    const distance = levenshteinDistance(baseDomain, popularDomain);

    // Only flag if 1-2 characters different (typo range)
    if (distance >= 1 && distance <= 2 && distance < smallestDistance) {
      smallestDistance = distance;
      closestMatch = popularDomain;
    }
  }

  if (closestMatch && smallestDistance <= 2) {
    return {
      isSuspicious: true,
      suggestion: closestMatch,
      distance: smallestDistance,
    };
  }

  return { isSuspicious: false };
}
