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

export function wouldExceedChannelLimit(
  flags: ChannelFlags,
  adding: readonly ChannelId[],
  maxChannels: number,
): boolean {
  if (!isLimited(maxChannels)) return false;
  const fresh = newChannelsAmong(flags, adding);
  if (fresh.length === 0) return false;
  return connectedChannelCount(flags) + fresh.length > maxChannels;
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
