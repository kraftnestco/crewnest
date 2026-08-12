'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { ChevronDown, Video } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/page-header';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Database } from '@/types/database';
import type { AppointmentStatus } from '@/types/domain';
import {
  cancelAppointmentAction,
  getAppointmentsPageAction,
  setAppointmentOutcomeAction,
  type AppointmentRow,
} from './actions';

type TenantRow = Pick<Database['public']['Tables']['tenants']['Row'], 'id' | 'business_name'>;

const ALL_CLIENTS = '__all__';

const STATUS_FILTERS: Array<{ value: AppointmentStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'booked', label: 'Booked' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no_show', label: 'No-show' },
];

const STATUS_BADGE: Record<AppointmentStatus, 'default' | 'outline' | 'secondary' | 'destructive'> = {
  booked: 'default',
  completed: 'secondary',
  cancelled: 'destructive',
  no_show: 'outline',
};

/**
 * Renders the appointment's start in the TENANT's timezone, not the viewer's.
 * Staff in another timezone must see the time the customer was actually given
 * — anything else silently misreports every appointment (docs/24 §3).
 */
function formatWhen(iso: string, timezone: string | null): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone ?? 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function AppointmentsView({
  initialAppointments,
  tenants,
  tenantTimezones,
  showBusinessColumn = true,
  chatBasePath = '/admin/chat',
  initialTenantId = null,
}: {
  initialAppointments: AppointmentRow[];
  tenants: TenantRow[];
  /** tenantId → IANA timezone, so each row renders in its own business's local time. */
  tenantTimezones: Record<string, string | null>;
  showBusinessColumn?: boolean;
  chatBasePath?: string;
  /** Agency-only; the single-tenant dashboard always passes null. */
  initialTenantId?: string | null;
}) {
  const [appointments, setAppointments] = useState(initialAppointments);
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | 'all'>('booked');
  const [tenantFilter, setTenantFilter] = useState<string>(initialTenantId ?? ALL_CLIENTS);
  const [upcomingOnly, setUpcomingOnly] = useState(true);
  const [hasMore, setHasMore] = useState(initialAppointments.length === 25);
  const [isPending, startTransition] = useTransition();

  const tenantMap = useMemo(() => new Map(tenants.map((t) => [t.id, t.business_name])), [tenants]);
  const columnCount = showBusinessColumn ? 7 : 6;

  function reload(next: {
    status?: AppointmentStatus | 'all';
    tenant?: string;
    upcoming?: boolean;
  }) {
    const status = next.status ?? statusFilter;
    const tenant = next.tenant ?? tenantFilter;
    const upcoming = next.upcoming ?? upcomingOnly;

    startTransition(async () => {
      try {
        const page = await getAppointmentsPageAction({
          status,
          tenantId: tenant === ALL_CLIENTS ? null : tenant,
          upcomingOnly: upcoming,
        });
        setAppointments(page.appointments);
        setHasMore(page.hasMore);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load appointments.');
      }
    });
  }

  function handleLoadMore() {
    const last = appointments[appointments.length - 1];
    if (!last) return;
    startTransition(async () => {
      try {
        const page = await getAppointmentsPageAction({
          status: statusFilter,
          tenantId: tenantFilter === ALL_CLIENTS ? null : tenantFilter,
          upcomingOnly,
          before: last.starts_at,
        });
        setAppointments((prev) => [...prev, ...page.appointments]);
        setHasMore(page.hasMore);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load more.');
      }
    });
  }

  function runAction(fn: () => Promise<void>, successMessage: string) {
    startTransition(async () => {
      try {
        await fn();
        toast.success(successMessage);
        reload({});
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Something went wrong.');
      }
    });
  }

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <PageHeader
        title="Appointments"
        description="Bookings the AI made in chat. Times show in each business's own timezone."
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={statusFilter === f.value ? 'default' : 'outline'}
              onClick={() => {
                setStatusFilter(f.value);
                reload({ status: f.value });
              }}
              disabled={isPending}
            >
              {f.label}
            </Button>
          ))}
        </div>

        <Button
          size="sm"
          variant={upcomingOnly ? 'default' : 'outline'}
          onClick={() => {
            const next = !upcomingOnly;
            setUpcomingOnly(next);
            reload({ upcoming: next });
          }}
          disabled={isPending}
        >
          {upcomingOnly ? 'Upcoming' : 'All dates'}
        </Button>

        {/* Agency-only client filter — same pattern as Orders and the bell. */}
        {showBusinessColumn && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={isPending}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="max-w-40 truncate">
                {tenantFilter === ALL_CLIENTS ? 'All clients' : (tenantMap.get(tenantFilter) ?? 'All clients')}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-72 min-w-56">
              <DropdownMenuRadioGroup
                value={tenantFilter}
                onValueChange={(v) => {
                  setTenantFilter(v);
                  reload({ tenant: v });
                }}
              >
                <DropdownMenuRadioItem value={ALL_CLIENTS}>All clients</DropdownMenuRadioItem>
                {tenants.map((t) => (
                  <DropdownMenuRadioItem key={t.id} value={t.id}>
                    {t.business_name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="rounded-xl bg-card ring-1 ring-foreground/10 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Customer</TableHead>
              {showBusinessColumn && <TableHead>Business</TableHead>}
              <TableHead>Status</TableHead>
              <TableHead>Meeting</TableHead>
              <TableHead className="text-right">Chat</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {appointments.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">
                  {a.appointment_number != null && (
                    <span className="mr-1.5 text-xs font-normal text-muted-foreground">#{a.appointment_number}</span>
                  )}
                  {formatWhen(a.starts_at, tenantTimezones[a.tenant_id] ?? null)}
                  <div className="text-xs font-normal text-muted-foreground">{a.duration_minutes} min</div>
                </TableCell>
                <TableCell>
                  {a.customer_name || '—'}
                  {a.customer_phone && (
                    <div className="text-xs text-muted-foreground">{a.customer_phone}</div>
                  )}
                </TableCell>
                {showBusinessColumn && <TableCell>{tenantMap.get(a.tenant_id) ?? 'Unknown'}</TableCell>}
                <TableCell>
                  <Badge variant={STATUS_BADGE[a.status as AppointmentStatus] ?? 'outline'} className="capitalize">
                    {a.status.replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-xs">
                  {a.meeting_url ? (
                    <a
                      href={a.meeting_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2"
                    >
                      <Video className="h-3 w-3" />
                      Join
                    </a>
                  ) : a.location_text ? (
                    <span className="text-xs text-muted-foreground">{a.location_text}</span>
                  ) : (
                    // A blank link on a BOOKED appointment is a real, visible
                    // state — Cal.com may have failed while the booking stood
                    // (docs/24 §4.3). Staff attach one manually.
                    <span className="text-xs text-muted-foreground">
                      {a.status === 'booked' ? 'No link yet' : '—'}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {a.session_id ? (
                    <Link
                      href={`${chatBasePath}?session=${a.session_id}`}
                      className="text-xs text-primary underline underline-offset-2"
                    >
                      View chat
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {a.status === 'booked' ? (
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => runAction(() => setAppointmentOutcomeAction(a.id, 'completed'), 'Marked completed.')}
                      >
                        Done
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => runAction(() => setAppointmentOutcomeAction(a.id, 'no_show'), 'Marked no-show.')}
                      >
                        No-show
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={isPending}
                        onClick={() => runAction(() => cancelAppointmentAction(a.id), 'Appointment cancelled.')}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {appointments.length === 0 && (
              <TableRow>
                <TableCell colSpan={columnCount} className="py-8 text-center text-muted-foreground">
                  No appointments here yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={handleLoadMore} disabled={isPending}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
