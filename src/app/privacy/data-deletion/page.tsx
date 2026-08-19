import type { Metadata } from 'next';
import { LegalPage } from '@/app/_landing/legal-page';
import { createServiceClient } from '@/lib/supabase/service';
import { SUPPORT_EMAIL } from '@/lib/constants';

export const metadata: Metadata = {
  title: 'Data deletion status — ClerkNest',
  description: 'Status of a Facebook/Instagram data deletion request submitted through Meta.',
};

export default async function DataDeletionStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const confirmationCode = code?.trim() ?? '';

  let status: 'missing' | 'unknown' | 'received' | 'completed' = 'missing';
  if (confirmationCode) {
    const svc = createServiceClient();
    const { data } = await svc
      .from('meta_deletion_requests')
      .select('status')
      .eq('confirmation_code', confirmationCode)
      .maybeSingle();
    status = data?.status === 'completed' ? 'completed' : data ? 'received' : 'unknown';
  }

  return (
    <LegalPage title="Data deletion request" updated="August 19, 2026">
      {status === 'missing' && (
        <p>
          This page shows the status of a data-deletion request Meta sent us. If you arrived from Facebook,
          the link should include a confirmation code. Questions:{' '}
          <a className="underline hover:text-foreground" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      )}
      {status === 'unknown' && (
        <p>
          We could not find confirmation code <code>{confirmationCode}</code>. If you just submitted the
          request, wait a moment and refresh. Otherwise contact{' '}
          <a className="underline hover:text-foreground" href={`mailto:${SUPPORT_EMAIL}`}>
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      )}
      {status === 'received' && (
        <p>
          We received your deletion request (code <code>{confirmationCode}</code>). We will remove associated
          Facebook user data from ClerkNest within 30 days. You can bookmark this page to check again.
        </p>
      )}
      {status === 'completed' && (
        <p>
          Deletion request <code>{confirmationCode}</code> is complete. Associated Facebook user data has been
          removed from ClerkNest.
        </p>
      )}
    </LegalPage>
  );
}
