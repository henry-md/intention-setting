# Social DM Home navigation

## What broke

An unconditional Manifest V3 declarative-network rule redirected the Instagram and TikTok root URLs to DMs. That rule also ran after the user clicked the injected **Open home** control, so the tab immediately returned to DMs. A pending background fallback redirect could also remain after a prior root navigation and reapply to Home.

## Fix applied

- Route root visits in `background.ts`, where the per-tab `dmHomeBypasses` session state can be checked.
- When the user moves from DMs to Home through the site's SPA navigation, store the bypass and clear any pending DM redirect.
- Clear the pending fallback when the intended DM URL commits, as well as when a bypassed Home navigation begins.
- Give root redirects a 400 ms grace period so the content script can report native DM-to-Home navigation. Pointer hover or press within the leftmost 96 pixels of a DM page also arms a two-second token, allowing Home intent to reach the worker before navigation. The token uses pointer position and does not identify a specific Home element.
- The bypass is scoped to the social site and tab rather than the literal root URL. Do not clear it for Instagram/TikTok post, comment, or profile routes; clear it only when the tab leaves that site or closes.

## Verification rule

For social-site navigation, do not treat an anonymous or synthetic browser capture as proof. Reuse Henry's signed-in Chrome session and capture both directions after a multi-second wait:

1. New tab: site root → real DM inbox.
2. DM inbox: the site's native Home control → real signed-in feed remains at the root URL.

Check both Instagram and TikTok whenever this routing code changes.
Also reload the unpacked extension while already on a DM page, click Home immediately, and prove that the final signed-in feed remains at the root URL.
Open and close a post's comments before that final check.
