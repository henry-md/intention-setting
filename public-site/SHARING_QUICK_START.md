# Public Sharing - Quick Start Guide

## What Was Added

Public sharing allows users to share their usage statistics via a unique URL. **Private by default.**

## How to Use

### For Users (Sharing Your Stats)

1. **Navigate to your stats page**
   ```
   http://localhost:3000/stats
   ```

2. **Find the "Public Sharing" card** at the top of the page

3. **Toggle the switch ON**
   - A unique share URL will be generated
   - Example: `http://localhost:3000/public/lm3n4p5q-xyz12345`

4. **Click "Copy"** to copy the URL to your clipboard

5. **Share the link** with anyone you want to view your stats

6. **Toggle OFF** anytime to disable sharing
   - The link will stop working immediately
   - The same link can be re-enabled later

### For Viewers (Viewing Shared Stats)

1. **Open the shared URL** (no account needed)

2. **View the statistics** - same display as the owner sees

3. **Can't see stats?** The owner may have disabled sharing

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     User Enables Sharing                     │
└──────────────────────────────┬──────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                │                               │
                ▼                               ▼
    ┌──────────────────────┐      ┌───────────────────────┐
    │  users/{uid}/private/│      │ shareIdMappings/      │
    │  shareSettings       │      │ {shareId}             │
    │                      │      │                       │
    │  enabled: true       │      │  userId: "{uid}"      │
    │  shareId: "abc123"   │      │  enabled: true        │
    │  createdAt: ...      │      │  updatedAt: ...       │
    │  updatedAt: ...      │      │                       │
    └──────────────────────┘      └───────────────────────┘
                │                               │
                │                               │
                └───────────────┬───────────────┘
                                │
                                ▼
                ┌───────────────────────────────┐
                │  Public Viewer Visits URL     │
                │  /public/{shareId}            │
                └───────────────┬───────────────┘
                                │
                                ▼
                ┌───────────────────────────────┐
                │  1. Lookup shareId            │
                │  2. Get userId                │
                │  3. Check enabled status      │
                │  4. Fetch user's stats        │
                │  5. Display to viewer         │
                └───────────────────────────────┘
```

## Modular Components

All stats display components are now modular and reusable:

**`<StatsOverview />`** - Overview cards (sites tracked, time spent, etc.)
**`<SiteBreakdown />`** - Detailed site list with progress bars
**`<SharingToggle />`** - Toggle switch for enabling/disabling sharing

This makes it easy to customize what's shown on private vs. public pages.

## Routes

| Route | Access | Description |
|-------|--------|-------------|
| `/stats` | Authenticated only | User's private statistics with sharing toggle |
| `/public/[shareId]` | Anyone | Public view of shared statistics |

## Key Features

✅ **Private by default** - Sharing must be explicitly enabled
✅ **Unique URLs** - Each user gets a unique, hard-to-guess shareId
✅ **Instant toggle** - Enable/disable sharing immediately
✅ **Copy to clipboard** - One-click URL copying
✅ **Same display** - Public page looks identical to private view
✅ **Modular** - Easy to diverge public/private views in the future
✅ **Real-time** - Stats update automatically
✅ **No account needed** - Viewers don't need to sign in

## Security

- ShareIds are randomly generated and hard to guess
- Sharing can be disabled instantly
- Only stats data is exposed (no personal info)
- No authentication required for viewing (by design)
- Firestore security rules control access

## Customization (Future)

The modular architecture makes it easy to add:
- Granular control over what to share
- Custom branding for public pages
- Password protection
- Time-based expiration
- View analytics
- Embed codes

## Testing Checklist

- [ ] Sign in and go to `/stats`
- [ ] Toggle sharing ON
- [ ] Copy the public URL
- [ ] Open URL in incognito window
- [ ] Verify stats are visible
- [ ] Toggle sharing OFF
- [ ] Refresh public page - should show error
- [ ] Toggle back ON - same URL works again

## Files Changed

**New:**
- `lib/sharingTypes.ts` - Type definitions
- `hooks/useShareSettings.ts` - Sharing logic hooks
- `components/SharingToggle.tsx` - Toggle UI
- `components/StatsOverview.tsx` - Modular overview
- `components/SiteBreakdown.tsx` - Modular breakdown
- `app/public/[shareId]/page.tsx` - Public stats page

**Modified:**
- `app/stats/page.tsx` - Now uses modular components

## Build Status

✅ **Build successful**

```
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /dashboard
├ ○ /login
├ ƒ /public/[shareId]     ← NEW: Dynamic public stats page
└ ○ /stats

ƒ  (Dynamic)  server-rendered on demand
```

## Next Steps

1. **Set up Firestore security rules** (see `PUBLIC_SHARING_SETUP.md`)
2. **Test the flow** locally
3. **Customize the public page** styling if needed
4. **Add analytics** to track public views
5. **Implement granular sharing** preferences

Full documentation: `PUBLIC_SHARING_SETUP.md`
