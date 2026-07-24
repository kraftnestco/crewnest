import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * The CrewNest bird mark. Light mode uses the real app icon
 * (public/icons/icon-192.png — white bird on the brand-green tile) so every
 * lockup is pixel-identical to the browser-tab/home-screen icon. Dark mode
 * swaps to a black tile with a green bird (icon-192-bird-green.png, generated
 * from the same art) and a green ring, matching the copilot avatar's accent so
 * the mark doesn't sit as a bright green block on a near-black sidebar.
 */
export function Logomark({ className }: { className?: string }) {
  return (
    <span className={cn('relative block size-8 shrink-0 overflow-hidden rounded-[22.5%]', className)}>
      {/* Light: the real app icon (green tile, white bird). */}
      <Image src="/icons/icon-192.png" alt="" width={32} height={32} priority className="size-full dark:hidden" />
      {/* Dark: black tile, green bird, green border. */}
      <span className="hidden size-full items-center justify-center bg-black ring-1 ring-inset ring-primary dark:flex">
        <Image src="/icons/icon-192-bird-green.png" alt="" width={32} height={32} priority className="size-full" />
      </span>
    </span>
  );
}
