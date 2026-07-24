import { PageHeader } from '@/components/page-header';
import { AdminCopilot } from '@/components/copilot/admin-copilot';

/** docs/20 Part 2 — advisory-only chat over the same signals System health surfaces. */
export default function AdminCopilotPage() {
  return (
    <div className="space-y-6 p-6">
      <PageHeader title="Copilot" description="Ask about any client or customer across the agency." />
      <AdminCopilot />
    </div>
  );
}
