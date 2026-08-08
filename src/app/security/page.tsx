import type { Metadata } from 'next';
import { LegalPage } from '@/app/_landing/legal-page';
import { SUPPORT_EMAIL } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'How we connect your channels — CrewNest',
  description: 'Exactly what CrewNest can and cannot see when you connect WhatsApp, Messenger, or Instagram.',
};

export default function SecurityPage() {
  return (
    <LegalPage title="How we connect your channels" updated="August 8, 2026">
      <p>
        The short version: <strong>we never ask for, see, or store your Facebook, Instagram, or WhatsApp
        password.</strong> This page explains exactly what CrewNest can and can&apos;t see once a channel is
        connected, in plain language — no jargon.
      </p>

      <h2>How the connection actually works</h2>
      <p>
        For WhatsApp, Messenger, and Instagram, you add CrewNest as a <strong>Partner</strong> on your own Meta
        Business Manager — a permission Meta itself manages, not something we invent. You stay logged in as
        yourself the whole time; you&apos;re granting a scoped, revocable permission, not handing over a login.
        We&apos;re never shown your password, and there&apos;s no login screen where we could see it even if we
        wanted to.
      </p>

      <h2>What we can see</h2>
      <ul>
        <li>Messages customers send to the channels you&apos;ve connected, so your AI assistant can reply.</li>
        <li>The catalogue, prices, hours, and policies you&apos;ve given us to answer from.</li>
        <li>Orders placed through those conversations — items, delivery details, payment status.</li>
      </ul>

      <h2>What we can&apos;t see</h2>
      <ul>
        <li>Your Facebook, Instagram, or WhatsApp password — we never have it, so there&apos;s nothing to leak.</li>
        <li>Personal messages or posts unrelated to the business account you connected.</li>
        <li>Your ad account, billing details, or payment methods on Meta.</li>
        <li>Anything outside the specific channel you chose to connect.</li>
      </ul>

      <h2>Where the access itself is kept</h2>
      <p>
        The access Meta grants us is stored encrypted. It isn&apos;t something a person at CrewNest can open and
        read — our system uses it automatically, only to send and receive messages on the channel you connected,
        and for nothing else.
      </p>

      <h2>Turning it off</h2>
      <p>
        You&apos;re in control of the permission the whole time. You can remove CrewNest&apos;s Partner access
        from your own Meta Business Manager at any moment, or ask us to disconnect a channel, and it stops
        immediately. Questions? Reach us at{' '}
        <a className="underline hover:text-foreground" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </LegalPage>
  );
}
