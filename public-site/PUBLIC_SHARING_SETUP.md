# Public Sharing Feature

Users can now share their usage statistics publicly via a unique, shareable link. Sharing is **private by default** and must be explicitly enabled.

## Architecture Overview

### Data Structure

**Firestore Collections:**

```
users/{userId}/
  ├── private/
  │   └── shareSettings
  │       ├── enabled: boolean
  │       ├── shareId: string (unique identifier)
  │       ├── createdAt: number
  │       └── updatedAt: number

shareIdMappings/{shareId}/
  ├── userId: string
  ├── enabled: boolean
  └── updatedAt: number
```

**Why Two Documents?**
1. `users/{userId}/private/shareSettings` - User's personal sharing preferences (private)
2. `shareIdMappings/{shareId}` - Public lookup table to find userId from shareId

This separation allows:
- Private storage of user settings
- Efficient public lookups without exposing user IDs
- Easy enabling/disabling without changing the shareId

### Share ID Generation

Share IDs are generated using:
```typescript
const timestamp = Date.now().toString(36);
const randomStr = Math.random().toString(36).substring(2, 10);
return `${timestamp}-${randomStr}`;
```

Example: `lm3n4p5q-xyz12345`

This provides:
- Uniqueness through timestamp
- Additional randomness for security
- URL-safe characters
- Short, shareable format

## Components

### 1. Sharing Toggle (`components/SharingToggle.tsx`)

A toggle switch component that:
- Displays current sharing status
- Allows users to enable/disable sharing
- Shows the shareable URL when enabled
- Includes a copy-to-clipboard button
- Shows warning when sharing is enabled

**Features:**
- ✅ Real-time sync with Firestore
- ✅ Instant URL generation
- ✅ Copy to clipboard functionality
- ✅ Visual feedback (toggle animation, "Copied!" message)
- ✅ Warning banner when public

### 2. Stats Components (Modular)

**`StatsOverview.tsx`** - Overview cards showing:
- Total sites tracked
- Total time spent
- Average progress
- Sites over limit

**`SiteBreakdown.tsx`** - Detailed site list with:
- Site name/URL
- Rule type badge
- Progress bars
- Time remaining
- Status indicators

**Benefits of Modularization:**
- Reusable across private and public views
- Easy to customize what data is shown publicly
- Consistent UI/UX
- Single source of truth for display logic

### 3. Hooks

**`useShareSettings()`** - For authenticated users:
```typescript
const {
  shareSettings,     // Current sharing settings
  loading,           // Loading state
  isEnabled,         // Quick boolean check
  enableSharing,     // Enable sharing function
  disableSharing,    // Disable sharing function
  toggleSharing,     // Toggle on/off
} = useShareSettings();
```

**`usePublicUserData(shareId)`** - For public access:
```typescript
const {
  userId,  // User ID resolved from shareId
  loading, // Loading state
  error,   // Error if share link is invalid/disabled
} = usePublicUserData(shareId);
```

## Pages

### Private Stats Page (`/stats`)

**For authenticated users only**

Features:
- Full navigation (header with links)
- Sharing toggle at the top
- Complete usage statistics
- Real-time updates
- Sign out button

**New Additions:**
- Sharing toggle component
- Modular stats display

### Public Stats Page (`/public/[shareId]`)

**Accessible to anyone with the link**

Features:
- Minimal header (just branding)
- Info banner explaining it's a shared view
- Same stats display as private page
- Call-to-action to sign up
- Footer with branding

**What's Different:**
- No authentication required
- No sharing toggle (can't control someone else's sharing)
- No navigation links
- Read-only view
- Informational banners

## User Flow

### Enabling Sharing

1. User navigates to `/stats`
2. Sees sharing toggle (default: OFF)
3. Clicks toggle to enable
4. System generates unique `shareId` (or reuses existing)
5. Shareable URL appears: `https://yoursite.com/public/xyz123`
6. User clicks "Copy" button
7. URL copied to clipboard
8. User shares URL with others

### Disabling Sharing

1. User toggles OFF
2. Link becomes invalid immediately
3. Public page shows "sharing disabled" error
4. ShareId is preserved (can be re-enabled with same link)

### Viewing Shared Stats

1. Someone visits shared URL
2. System looks up `shareId` in `shareIdMappings`
3. Checks if sharing is still enabled
4. If enabled: Fetches and displays user's stats
5. If disabled: Shows error message

## Security & Privacy

### Default Privacy
- **Sharing is OFF by default**
- Users must explicitly enable it
- Clear warning when enabled

### Access Control
- Public pages check if sharing is enabled
- Invalid/disabled links show appropriate errors
- No user identification in public view (just stats)

### Data Exposure
Currently, when sharing is enabled, all stats are public:
- ✅ Rules and limits
- ✅ Groups
- ✅ Time tracking data
- ✅ Overall statistics

**Future Enhancement:** Granular control over what to share

### Firebase Security Rules

**Required rules** (add to Firestore security rules):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // User documents (private by default)
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;

      // Share settings (private subcollection)
      match /private/{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }

    // Share ID mappings (public read for lookups)
    match /shareIdMappings/{shareId} {
      allow read: if true;  // Anyone can look up shareId
      allow write: if request.auth != null &&
                      request.auth.uid == resource.data.userId;
    }

    // Allow public read of user data if sharing is enabled
    // This requires checking the mapping first
    match /users/{userId} {
      allow read: if exists(/databases/$(database)/documents/shareIdMappings/$(request.query.shareId)) &&
                     get(/databases/$(database)/documents/shareIdMappings/$(request.query.shareId)).data.userId == userId &&
                     get(/databases/$(database)/documents/shareIdMappings/$(request.query.shareId)).data.enabled == true;
    }
  }
}
```

**Note:** The public page currently fetches data after confirming the shareId is valid. For production, consider implementing Firestore security rules or server-side API routes for better security.

## Testing

### Local Development

```bash
cd public-site
npm run dev
```

### Test Flow

1. **Enable Sharing**
   - Sign in at `http://localhost:3000`
   - Go to `/stats`
   - Toggle sharing ON
   - Copy the public URL

2. **Test Public Access**
   - Open the public URL in an incognito window (or different browser)
   - Verify stats are visible
   - Check that all components render correctly

3. **Disable Sharing**
   - Go back to authenticated session
   - Toggle sharing OFF
   - Refresh public page - should show error

4. **Re-enable**
   - Toggle back ON
   - Same URL should work again

## Future Enhancements

### Granular Sharing Control

Add preferences for what to share:

```typescript
interface SharePreferences {
  showRules: boolean;        // Show rule configurations
  showGroups: boolean;       // Show site groupings
  showTimeTracking: boolean; // Show actual time data
  showOverallStats: boolean; // Show summary statistics
}
```

Then conditionally render components:

```tsx
{preferences.showOverallStats && <StatsOverview stats={overallStats} />}
{preferences.showTimeTracking && <SiteBreakdown stats={sortedStats} />}
```

### Custom Branding

Allow users to customize their public page:
- Custom title/description
- Profile picture
- Bio/message
- Color theme

### Analytics

Track public page views:
- Number of views
- Unique visitors
- Most viewed time periods
- Geographic data

### Expiring Links

Add time-based expiration:
- Share for 24 hours
- Share until specific date
- Auto-disable after X days

### Password Protection

Add optional password for public links:
- Set password when enabling sharing
- Require password to view stats
- Different passwords for different viewers

### Embedding

Allow embedding stats in other sites:
- Generate embed code
- iframe support
- Custom styling options

## Files Created/Modified

### New Files

```
public-site/
├── lib/
│   └── sharingTypes.ts              # Type definitions for sharing
├── hooks/
│   └── useShareSettings.ts          # Hooks for sharing logic
├── components/
│   ├── SharingToggle.tsx            # Toggle UI component
│   ├── StatsOverview.tsx            # Modular overview cards
│   └── SiteBreakdown.tsx            # Modular site list
└── app/
    └── public/
        └── [shareId]/
            └── page.tsx             # Public stats page
```

### Modified Files

```
public-site/
└── app/
    └── stats/
        └── page.tsx                 # Updated to use modular components
```

## API/Database Schema

### Write Operations (Authenticated)

**Enable Sharing:**
```typescript
// Write to users/{uid}/private/shareSettings
{
  enabled: true,
  shareId: "abc123-xyz789",
  createdAt: 1234567890,
  updatedAt: 1234567890
}

// Write to shareIdMappings/abc123-xyz789
{
  userId: "user123",
  enabled: true,
  updatedAt: 1234567890
}
```

**Disable Sharing:**
```typescript
// Update both documents with enabled: false
```

### Read Operations (Public)

1. Fetch `shareIdMappings/{shareId}`
2. Extract `userId` and check `enabled`
3. If enabled, fetch `users/{userId}` document
4. Display stats from user document

## Troubleshooting

### "Share link not found"
- ShareId is invalid or doesn't exist
- User never enabled sharing
- Check the URL is correct

### "Sharing is disabled for this user"
- User has disabled sharing
- The shareId exists but sharing is toggled off
- User can re-enable to restore access

### Stats not updating on public page
- Public page is a snapshot, not real-time
- Refresh the page to see latest data
- Consider implementing real-time subscriptions for public pages

### Can't enable sharing
- Check authentication (must be signed in)
- Verify Firestore permissions
- Check browser console for errors

## Notes

- ShareIds are persistent - disabling and re-enabling uses the same shareId
- Public pages don't require authentication
- Real-time updates work on both private and public pages
- Modular components make it easy to diverge private/public views in the future
- Consider rate limiting public page access in production
- Monitor Firestore reads - popular public links could consume quota
