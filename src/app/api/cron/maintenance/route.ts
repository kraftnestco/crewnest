import { type NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { env } from '@/lib/env';
import { runDailyMaintenance } from '@/services/maintenance';
import { log } from '@/lib/log';

/**
 * Doc-17 §3.1 — the Phase-3 daily maintenance job's trigger. Scheduled by
 * vercel.json's `crons` array, NOT pg_cron: runDailyMaintenance() deletes
 * real Supabase Storage objects, which only the JS Storage SDK can reach.
 *
 * Auth: Vercel signs scheduled requests with `Authorization: Bearer
 * $CRON_SECRET` when CRON_SECRET is set as a project env var — verified here.
 * Fails closed (403) if CRON_SECRET isn't provisioned yet, same as every
 * other optional-bolt-on integration in this codebase (Resend, Sentry).
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!env.CRON_SECRET) {
    log.error('[cron/maintenance] rejected — CRON_SECRET not provisioned');
    return new Response('Forbidden', { status: 403 });
  }

  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return new Response('Forbidden', { status: 403 });
  }

  try {
    const result = await runDailyMaintenance();
    return Response.json({ ok: true, result });
  } catch (err) {
    log.error('[cron/maintenance] run failed', { error: err instanceof Error ? err.message : String(err) });
    Sentry.captureException(err, { tags: { job: 'daily-maintenance' } });
    return new Response('Internal error', { status: 500 });
  }
}
