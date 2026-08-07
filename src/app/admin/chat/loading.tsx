import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex h-full overflow-hidden">
      {/* Mirrors the real inbox: full-width list on mobile, fixed rail from lg. */}
      <div className="flex w-full shrink-0 flex-col gap-2 border-r p-3 lg:w-80">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
      <div className="hidden min-w-0 flex-1 items-center justify-center lg:flex">
        <Skeleton className="h-8 w-48" />
      </div>
    </div>
  );
}
