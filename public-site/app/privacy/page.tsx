import Link from 'next/link';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-zinc-50 px-6 py-10 dark:bg-transparent">
      <div className="mx-auto w-full max-w-3xl rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Privacy Policy</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Last updated: February 23, 2026
          </p>
        </div>

        <div className="space-y-6 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          <section>
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Overview
            </h2>
            <p>
              Intention Setter helps you track time usage and manage limits. This policy describes
              what information we may collect, how we may use it, and the choices you have.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Information We May Collect
            </h2>
            <p>
              Depending on features you use, we may collect account details (such as your email and
              profile image), app settings, usage metrics, rule configurations, group/site
              mappings, and public sharing preferences. We may also collect basic technical
              information needed to run and protect the service.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              How We May Use Information
            </h2>
            <p>
              We may use information to operate and improve the product, personalize your
              experience, provide support, monitor reliability, prevent abuse, develop new
              features, and communicate updates. We may also use data for internal analysis and
              legal compliance.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Sharing and Disclosure
            </h2>
            <p>
              We will not sell your data ever. Your site usage data will remain private to you, other 
              than the bits you choose to share publicly. We may share information with trusted service
              providers that help us operate the service (such as hosting, analytics, and payment
              providers). We may also disclose information when required by law, to enforce our
              terms, to protect safety, or as part of a business transfer. If you enable public
              sharing features, information you choose to share may be visible to anyone with the
              link.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Data Retention
            </h2>
            <p>
              We keep information for as long as reasonably needed to provide the service and meet
              legal obligations. Retention periods can vary based on the type of data.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Your Choices
            </h2>
            <p>
              You can sign out, change settings, and disable public sharing. If you want account or
              data-related help, contact us and we will review requests case-by-case, subject to
              technical, legal, and operational constraints.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Security
            </h2>
            <p>
              We use reasonable safeguards designed to protect information, but no system is
              perfectly secure and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Policy Changes
            </h2>
            <p>
              We may update this policy from time to time. Continued use of the service after an
              update means you accept the revised policy.
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
