# Usage Statistics Dashboard

The Next.js app now displays real-time usage statistics from the Chrome extension's Firebase data.

## What Was Added

### 1. Custom Hook: `useUserData` (`hooks/useUserData.ts`)

A React hook that fetches and subscribes to user data from Firestore in real-time:

```typescript
const { userData, loading, error } = useUserData();
```

**Returns:**
- `userData`: Object containing:
  - `rules`: Array of time limit rules configured in the extension
  - `groups`: Array of site groups
  - `dailyUsageHistory`: Map of day keys (`YYYY-MM-DD`) to daily usage entries
  - `lastDailyResetTimestamp`: When the daily reset last occurred
- `loading`: Boolean indicating if data is still loading
- `error`: Any error that occurred during fetch

**Features:**
- Real-time updates using Firestore's `onSnapshot`
- Automatically subscribes when user is authenticated
- Automatically unsubscribes on cleanup
- Handles missing data gracefully

### 2. Statistics Helper Functions (`lib/statsHelpers.ts`)

Utility functions for processing and displaying statistics:

**Core Functions:**
- `expandTargetsToUrls()` - Expands rule targets (URLs and groups) into full URL lists
- `formatTime()` - Converts seconds to human-readable format (e.g., "2h 30m")
- `calculateProgress()` - Calculates percentage of time limit used
- `getProgressColor()` - Returns appropriate color class based on progress
- `buildSiteStats()` - Creates comprehensive statistics for each tracked site
- `calculateOverallStats()` - Aggregates data for overview cards

**Data Structures:**
```typescript
interface SiteStats {
  siteKey: string;
  displayName: string;
  rule: Rule;
  timeSpent: number;
  timeLimit: number;
  percentage: number;
  remaining: number;
  status: string;  // "On Track", "Halfway", "Almost Done", "Limit Reached"
  color: string;   // Tailwind color class for progress bar
}

interface OverallStats {
  totalSitesTracked: number;
  totalTimeSpent: number;
  totalTimeLimit: number;
  sitesOverLimit: number;
  sitesNearLimit: number;
  averageProgress: number;
}
```

### 3. Statistics Page (`app/stats/page.tsx`)

A comprehensive dashboard showing:

**Overview Cards:**
- Total number of sites being tracked
- Total time spent across all sites
- Average progress percentage
- Number of sites over their limits

**Site Breakdown:**
- List of all tracked sites sorted by usage percentage
- For each site:
  - Site name/URL
  - Rule type badge (hard/soft/session)
  - Custom rule name (if set)
  - Time spent vs. time limit
  - Time remaining
  - Visual progress bar with color coding:
    - Green: < 50%
    - Yellow: 50-74%
    - Orange: 75-89%
    - Red: 90-100%
  - Status text based on progress
  - Exact percentage

**Real-time Updates:**
- Data automatically refreshes as the extension updates Firestore
- No need to reload the page

### 4. Navigation Updates

Updated navigation across pages:
- **Home Page**: Added "View Statistics" and "Dashboard" buttons for authenticated users
- **Dashboard Page**: Added navigation to Statistics page
- **Statistics Page**: Includes navigation back to Dashboard

## How It Works

### Data Flow

1. **Chrome Extension** tracks time spent on sites
   - Stores data locally in Chrome storage
   - Syncs to Firebase every 5 seconds
   - Writes to: `users/{userId}/dailyUsageHistory/{YYYY-MM-DD}` (field map entry)

2. **Next.js App** subscribes to changes
   - `useUserData` hook listens to the user's document
   - Automatically updates when extension syncs new data
   - No polling required - uses Firestore's real-time subscriptions

3. **Statistics Calculation**
   - Processes raw Firestore data
   - Expands groups to individual sites
   - Calculates progress percentages
   - Determines status and colors

### Firebase Structure

```
users/{userId}/
  ├── rules: Rule[]           // Time limit rules
  ├── groups: Group[]         // Site groupings
  ├── dailyUsageHistory: {    // Historical + current day usage
  │     "2026-03-01": {
  │       totalTimeSpent: 1827,
  │       trackedSiteCount: 3,
  │       siteTotals: { "tiktok.com": 1740, "youtube.com": 60, "snapchat.com": 27 },
  │       periodStart: 1772269200000,
  │       periodEnd: 1772335784066,
  │       capturedAt: 1772335784066
  │     }
  │   }
  └── lastDailyResetTimestamp: number
```

## Usage Examples

### Viewing Statistics

1. **Start the dev server**: `npm run dev`
2. **Sign in** with your Google account
3. **Navigate to `/stats`** or click "View Statistics" from the home page
4. **Install the Chrome extension** if you haven't already
5. **Configure rules** in the extension (Settings → Rules)
6. **Browse tracked sites** to accumulate usage data
7. **Watch the statistics update in real-time** on the web app

### Testing the Real-time Sync

1. Open the web app in one window: `http://localhost:3000/stats`
2. Use your browser normally while the extension tracks time
3. Watch the progress bars update automatically every 5 seconds
4. No need to refresh the page!

### Understanding the Display

**Color Coding:**
- **Green Bar**: You're doing well, plenty of time left
- **Yellow Bar**: You've used about half your limit
- **Orange Bar**: Getting close to the limit (75%+)
- **Red Bar**: Almost at or over your limit (90%+)

**Status Messages:**
- **"On Track"**: < 50% used
- **"Halfway"**: 50-89% used
- **"Almost Done"**: 90-99% used
- **"Limit Reached"**: 100% used

## Type Safety

All data structures are fully typed with TypeScript:
- `Rule` - Time limit rule definition
- `Group` - Site grouping definition
- `SiteTimeData` - Individual site usage tracking
- `UserData` - Complete user data from Firestore
- `SiteStats` - Processed statistics for display
- `OverallStats` - Aggregated statistics

## File Structure

```
public-site/
├── app/
│   └── stats/
│       └── page.tsx          # Statistics dashboard page
├── hooks/
│   └── useUserData.ts        # Firestore data fetching hook
├── lib/
│   ├── statsHelpers.ts       # Statistics processing utilities
│   └── firebase.ts           # Firebase configuration
└── contexts/
    └── AuthContext.tsx       # Authentication context
```

## Next Steps

### Potential Enhancements

1. **Charts and Graphs**
   - Add time-series charts showing usage over time
   - Pie charts for time distribution across sites
   - Weekly/monthly trends

2. **Filters and Sorting**
   - Filter by rule type (hard/soft/session)
   - Sort by different metrics (time spent, remaining, alphabetical)
   - Search for specific sites

3. **Historical Data**
   - Store daily snapshots of usage
   - View statistics from previous days/weeks
   - Compare current usage to historical averages

4. **Notifications**
   - Email digest of daily usage
   - Alerts when approaching limits
   - Weekly summary reports

5. **Export Data**
   - Download usage data as CSV
   - Export for analysis in other tools
   - Share reports with others

## Troubleshooting

### "No data available"
- Make sure you've configured rules in the Chrome extension
- Browse some tracked sites to generate usage data
- Check that you're signed in with the same Google account in both the extension and web app

### Data not updating in real-time
- Check browser console for errors
- Verify Firebase configuration is correct
- Ensure Firestore security rules allow read access

### Statistics look wrong
- Verify the extension is running and tracking correctly
- Check Chrome extension console for sync errors
- Confirm rules are properly configured in the extension

## Security Notes

- Statistics are only visible to the authenticated user
- Firestore security rules should restrict access to only the user's own data
- No sensitive information is displayed (only site URLs and usage times)
- All data stays within your Firebase project
