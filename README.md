# Boilerplate Chrome extension with Firebase OAuth & Stripe

- React, TS, Tailwind, Vite app
- Firebase backend w/ Google OAuth
- Stripe integration
- Module background & content scripts

## DevOps Integrations

https://www.youtube.com/watch?v=n09p8Y7XfNI

- Make sure you've replaced everything listed // TODO: Replace ..., as well as
  - extension/public/icons; extension/public/manifest.json name, description, icons, oauth2.client_id, key (shown in video tutorial as well); web/.firebaserc
- Safelist your firebase web app in Firebase authentication. Go to "Safelist client IDs" and add something like boilerplate-firebase-extension.firebaseapp.com & .web.app

To get from Test to Live mode
- After transactions run well in test, Repeat the steps to create a Stripe api key and webhook, but outside of Test mode [2:45 - 3:38, 3:55 - 4:47]. Replace those keys in your Firebase Extension.
- Copy your product in Stripe from the Test environment to the live environment. It's an option under menu of the product, so should just be one click.

Note:
- When uploading to chrome web store, you need to delete key in manifest.json. Then when you reload locally, add it back again so that you keep your constant extension id, which is required for redirection url to work in Stripe.
- In inspect element, make sure you have Settings > Sources > "Javascript source maps" enabled for source maps.
- Was running into some troubles that might be resolved from setting the Firebase rules to the most permissive things possible, allowing all reads and writes always.

### Things to change when going from Test to Prod for Stripe

- Change Stripe product_id to the right one
- Change the Stripe API key from a restricted key you generate outside of test mode (in Firebase extensions > config)
- Change Stripe webhook secret to one you made outside of test mode (same place, right below the key mentioned above)

### Setup & Development

```
cd extension
pnpm install
pnpm build

cd ../web
firebase deploy
```

- The build output will be in `build/`. This should be unpacked in your extension manager, which you can access at `chrome://extensions/`.

# LLM Context
Firebase docs for configuring OAuth (not great):
https://firebase.google.com/docs/auth/web/chrome-extension

Firebase Stripe integration:
https://firebase.google.com/docs/tutorials/payments-stripe#implementation_overview
