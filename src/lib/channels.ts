import { isLimited } from '@/lib/entitlements';

export const CHANNEL_IDS = ['whatsapp', 'facebook', 'instagram', 'web'] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

/** Which of the four owner-facing channels are currently live on a tenant. */
export interface ChannelFlags {
  whatsapp: boolean;
  facebook: boolean;
  instagram: boolean;
  web: boolean;
}

export function channelFlagsFromIds(ids: {
  whatsappPhoneNumberId?: string | null;
  metaPageId?: string | null;
  instagramId?: string | null;
  widgetPublicKey?: string | null;
}): ChannelFlags {
  return {
    whatsapp: Boolean(ids.whatsappPhoneNumberId),
    facebook: Boolean(ids.metaPageId),
    instagram: Boolean(ids.instagramId),
    web: Boolean(ids.widgetPublicKey),
  };
}

export function connectedChannelCount(flags: ChannelFlags): number {
  return CHANNEL_IDS.filter((k) => flags[k]).length;
}

/** Channels in `adding` that are not already connected. */
export function newChannelsAmong(flags: ChannelFlags, adding: readonly ChannelId[]): ChannelId[] {
  return adding.filter((c) => !flags[c]);
}

/**
 * How many plan "slots" a connect action consumes. Facebook (Messenger) and
 * Instagram each count as their OWN slot, even though a single Facebook
 * Login grant can hand back both at once (docs/27 §5 C2) — a business
 * decision, not a technical constraint: each platform is a distinct paid
 * channel. Callers that discover both from one OAuth grant (the connect
 * callback) are responsible for deciding which one(s) to actually save when
 * only some of them fit the plan — see connect/callback/route.ts.
 */
export function newChannelSlotsAmong(flags: ChannelFlags, adding: readonly ChannelId[]): number {
  return newChannelsAmong(flags, adding).length;
}

export function wouldExceedChannelLimit(
  flags: ChannelFlags,
  adding: readonly ChannelId[],
  maxChannels: number,
): boolean {
  if (!isLimited(maxChannels)) return false;
  const slots = newChannelSlotsAmong(flags, adding);
  if (slots === 0) return false;
  return connectedChannelCount(flags) + slots > maxChannels;
}

export function channelLimitMessage(maxChannels: number): string {
  return maxChannels === 1
    ? 'Your plan includes one channel at a time. Upgrade to connect more.'
    : `Your plan includes up to ${maxChannels} channels. Upgrade to connect more.`;
}

/**
 * Drop channels that are already live so "Setup requested" does not stick after
 * Connect / widget enable succeeds.
 */
export function pruneRequestedPlatforms(requested: string[] | null | undefined, flags: ChannelFlags): string[] {
  return (requested ?? []).filter((p) => {
    if (p === 'whatsapp') return !flags.whatsapp;
    if (p === 'facebook') return !flags.facebook;
    if (p === 'instagram') return !flags.instagram;
    if (p === 'web') return !flags.web;
    return true;
  });
}
