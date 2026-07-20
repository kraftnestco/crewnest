import { Phone, Camera, MessageCircle, Globe, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shared platform badge config (landing hero + demo chat skins) — real brand
 * colors, generic pictograms rather than trademarked logo artwork, same
 * convention demo-chat.tsx already uses for its bubble colors.
 */
export type PlatformId = 'whatsapp' | 'instagram' | 'messenger' | 'web';

export const PLATFORMS: Record<
  PlatformId,
  { label: string; bg: string; icon: LucideIcon }
> = {
  whatsapp: { label: 'WhatsApp', bg: 'bg-[#25D366]', icon: Phone },
  instagram: {
    label: 'Instagram DM',
    bg: 'bg-gradient-to-br from-[#833ab4] via-[#fd1d1d] to-[#fcb045]',
    icon: Camera,
  },
  messenger: { label: 'Messenger', bg: 'bg-[#0084FF]', icon: MessageCircle },
  web: { label: 'Website chat', bg: 'bg-foreground', icon: Globe },
};

export function PlatformBadge({
  platform,
  className,
  iconClassName,
}: {
  platform: PlatformId;
  className?: string;
  iconClassName?: string;
}) {
  const { bg, icon: Icon } = PLATFORMS[platform];
  return (
    <span
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-md',
        bg,
        className,
      )}
    >
      <Icon className={cn('size-4', iconClassName)} strokeWidth={2.25} />
    </span>
  );
}
