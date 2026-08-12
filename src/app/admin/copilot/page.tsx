import { PageHeader } from '@/components/page-header';
import { AdminCopilot } from '@/components/copilot/admin-copilot';

/** docs/20 Part 2 — advisory-only chat over the same signals System health surfaces. */
export default function AdminCopilotPage() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6">
      <PageHeader title="CrewAI" description="Ask about any client or customer across the agency." />
      <AdminCopilot />
    </div>
  );
}
