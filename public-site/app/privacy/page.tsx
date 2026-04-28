import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 dark:bg-transparent">
      <div className="mx-auto w-full max-w-3xl rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Privacy Policy</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Last updated: April 28, 2026
          </p>
        </div>

        <div className="space-y-6 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          <p>
            {
              "This page needs a privacy policy to be uploaded to the chrome web store. We're not doing anything crazy tho so here's a privacy policy:"
            }
          </p>

          <section>
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              What We Collect
            </h2>
            <p>
              Intention Setting collects only what it needs to run the extension and related web
              app: your Google sign-in profile, authentication data, settings, rules, groups,
              intentions, AI chat history, payment/subscription status, public sharing settings, and
              time totals for sites you choose to track. The extension reads the active site URL to
              match your rules, but it does not store a complete browsing history.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              How We Use It
            </h2>
            <p>
              We use this data to provide time limits, usage stats, account sync, public sharing,
              payments, support, security, and the AI assistant. We do not sell your data or use it
              for advertising.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Who We Share It With
            </h2>
            <p>
              We share data only with service providers needed to run the product: Google/Firebase
              for sign-in, hosting, database, and cloud functions; OpenAI when you use the AI
              assistant; and Stripe when you use paid features. If you enable public sharing, your
              shared stats, rules, groups, and tracked-site totals may be visible to anyone with the
              link. We may also disclose data if required by law or needed for security.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Storage and Choices
            </h2>
            <p>
              Data is stored in Chrome local storage and Firebase/Firestore and is transmitted over
              HTTPS. You can sign out, change rules and settings, disable public sharing, clear/reset
              usage data where available, or contact us to request deletion. We keep data while it is
              needed to provide the product or meet legal/security requirements.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Chrome Web Store Limited Use
            </h2>
            <p>
              The use of information received from Google APIs will adhere to the Chrome Web Store
              User Data Policy, including the Limited Use requirements.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Contact
            </h2>
            <p>
              Questions or deletion requests can be sent to{' '}
              <a
                href="mailto:henrymdeutsch@gmail.com"
                className="text-blue-600 hover:text-blue-500 dark:text-blue-400"
              >
                henrymdeutsch@gmail.com
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-8 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
          <Link href="/stats" className="text-blue-600 hover:text-blue-500 dark:text-blue-400">
            Back to app
          </Link>
        </div>
      </div>
    </div>
  );
}
