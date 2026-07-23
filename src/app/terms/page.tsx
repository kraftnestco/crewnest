import type { Metadata } from 'next';
import { LegalPage } from '@/app/_landing/legal-page';

export const metadata: Metadata = {
  title: 'Terms of Service — CrewNest',
  description: 'The terms that govern use of CrewNest.',
};

const CONTACT_EMAIL = 'kraftnestco@gmail.com';

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="July 23, 2026">
      <p>
        These terms govern your use of CrewNest, a service that gives businesses an AI assistant to answer their
        customers across WhatsApp, Facebook Messenger, Instagram, and website chat. By creating an account or
        using the service, you agree to them.
      </p>

      <h2>The service</h2>
      <p>
        CrewNest connects to messaging channels you authorize, answers customer messages using AI grounded in
        the business information you provide, records orders, and gives you a dashboard to supervise and take
        over conversations. AI-generated replies are produced automatically; you are responsible for reviewing
        how your assistant represents your business.
      </p>

      <h2>Your responsibilities</h2>
      <ul>
        <li>Provide accurate business information: prices, availability, and policies your AI relies on.</li>
        <li>
          Only connect channels and numbers you are authorized to use, and comply with the platform policies of
          the channels you connect (including Meta&apos;s WhatsApp Business and Messenger policies).
        </li>
        <li>Use the service lawfully: no spam, deception, or prohibited goods.</li>
        <li>Honor the orders and commitments your business (or your AI assistant on its behalf) makes to customers.</li>
      </ul>

      <h2>Plans &amp; billing</h2>
      <p>
        Free and paid plans are described on our pricing page. Paid plans are billed in advance and can be
        cancelled anytime; cancellation stops future charges but is not retroactive. We may change plan limits
        or pricing with reasonable notice.
      </p>

      <h2>Acceptable use &amp; suspension</h2>
      <p>
        We may suspend or terminate accounts that violate these terms, abuse the platform, or create risk for
        other users or for CrewNest&apos;s standing with the messaging platforms it depends on.
      </p>

      <h2>Disclaimers &amp; liability</h2>
      <p>
        The service is provided &quot;as is&quot;. AI replies can be imperfect; CrewNest is not liable for
        business outcomes arising from AI-generated responses, channel outages, or actions of the third-party
        platforms we connect to. To the maximum extent permitted by law, our total liability is limited to the
        fees you paid in the three months before the claim.
      </p>

      <h2>Changes &amp; contact</h2>
      <p>
        We may update these terms; material changes will be reflected on this page with a revised date.
        Questions? Contact{' '}
        <a className="underline hover:text-foreground" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </LegalPage>
  );
}
