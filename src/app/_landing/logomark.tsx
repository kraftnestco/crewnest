import Image from 'next/image';
import { cn } from '@/lib/utils';

/**
 * The actual favicon/app-icon asset (public/icons/icon-192.png), not a
 * recreated glyph — every on-page "ClerkNest" lockup should be pixel-identical
 * to the browser-tab/home-screen icon, not a different color and a different
 * bird drawn from a generic lucide icon.
 */
export function Logomark({ className }: { className?: string }) {
  return (
    <Image
      src="/icons/icon-192.png"
      alt=""
      width={32}
      height={32}
      priority
      className={cn('size-8 shrink-0 rounded-[22.5%]', className)}
    />
  );
}
