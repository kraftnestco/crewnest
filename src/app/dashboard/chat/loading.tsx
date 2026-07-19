import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex w-80 shrink-0 flex-col gap-2 border-r p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-lg" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <Skeleton className="h-8 w-48" />
      </div>
    </div>
  );
}
