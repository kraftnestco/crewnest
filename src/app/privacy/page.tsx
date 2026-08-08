import type { Metadata } from 'next';
import { LegalPage } from '@/app/_landing/legal-page';
import { SUPPORT_EMAIL } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Privacy Policy — CrewNest',
  description: 'How CrewNest collects, uses, and protects data for businesses and their customers.',
};


export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="July 23, 2026">
      <p>
        CrewNest (&quot;we&quot;, &quot;us&quot;) provides businesses with an AI assistant that answers their
        customers across WhatsApp, Facebook Messenger, Instagram, and website chat. This policy explains what
        data we handle, why, and the choices available to businesses using CrewNest (&quot;clients&quot;) and
        their customers.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account information</strong> — name, email address, and login credentials for people who sign
          in to CrewNest.
        </li>
        <li>
          <strong>Business information</strong> — the catalogue, prices, hours, policies, and brand voice a
          client provides so their AI assistant can answer accurately.
        </li>
        <li>
          <strong>Conversation data</strong>{' — '}messages, and any media a customer sends (such as photos, voice
          notes, or payment receipts), exchanged with a client&apos;s connected channels. This is processed to
          generate replies and is visible to that client in their dashboard.
        </li>
        <li>
          <strong>Order details</strong>{' — '}items, delivery addresses, and contact numbers customers share when
          placing an order through a client&apos;s AI assistant.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To generate AI replies grounded in the client&apos;s business information.</li>
        <li>To deliver messages through the channels a client has connected (Meta platforms, website chat).</li>
        <li>To record orders, payments, and conversation history in the client&apos;s dashboard.</li>
        <li>To notify clients when a conversation or order needs their attention.</li>
      </ul>
      <p>
        We do not sell personal data, and we do not use customer conversations to advertise to those customers.
      </p>

      <h2>Third-party services</h2>
      <p>
        To provide the service, data is processed by: <strong>Meta Platforms</strong>{' '}(WhatsApp Business
        Platform, Messenger, and Instagram messaging APIs, governed by Meta&apos;s own terms),{' '}
        <strong>AI model providers</strong> (conversation content is sent to a language-model API to generate
        replies), and <strong>our hosting and database providers</strong>. Each processes data only to provide
        their part of the service.
      </p>

      <h2>Data retention &amp; deletion</h2>
      <p>
        Conversation and order data is retained so clients can serve their customers and keep business records.
        Clients can erase an individual customer&apos;s conversation data from their dashboard. To request
        deletion of your data — as a client or as a customer of a business using CrewNest — contact us at{' '}
        <a className="underline hover:text-foreground" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>{' '}
        and we will process the request within 30 days.
      </p>

      <h2>Security</h2>
      <p>
        Access credentials and platform tokens are stored encrypted. Data is isolated per business, and access
        is restricted to the business it belongs to and to CrewNest staff who operate the service.
      </p>

      <h2>Changes</h2>
      <p>
        If this policy changes materially, we will update this page and revise the date above. Questions? Reach
        us at{' '}
        <a className="underline hover:text-foreground" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </LegalPage>
  );
}
