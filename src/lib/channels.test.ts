import { describe, expect, it } from 'vitest';
import {
  channelFlagsFromIds,
  channelLimitMessage,
  connectedChannelCount,
  newChannelsAmong,
  pruneRequestedPlatforms,
  wouldExceedChannelLimit,
} from './channels';

const empty = { whatsapp: false, facebook: false, instagram: false, web: false };

describe('channel cap', () => {
  it('counts live destinations', () => {
    expect(
      connectedChannelCount(
        channelFlagsFromIds({
          whatsappPhoneNumberId: '1',
          metaPageId: '2',
          instagramId: null,
          widgetPublicKey: null,
        }),
      ),
    ).toBe(2);
  });

  it('blocks a free plan from adding a second channel', () => {
    const flags = { ...empty, web: true };
    expect(wouldExceedChannelLimit(flags, ['facebook', 'instagram'], 1)).toBe(true);
    expect(wouldExceedChannelLimit(flags, ['web'], 1)).toBe(false);
  });

  it('allows reconnect of an already-connected channel', () => {
    const flags = { ...empty, facebook: true, instagram: true };
    expect(wouldExceedChannelLimit(flags, ['facebook', 'instagram'], 1)).toBe(false);
  });

  it('does not cap unlimited plans', () => {
    const flags = { ...empty, web: true };
    expect(wouldExceedChannelLimit(flags, ['whatsapp'], Infinity)).toBe(false);
  });

  it('names only genuinely new channels', () => {
    expect(newChannelsAmong({ ...empty, facebook: true }, ['facebook', 'instagram'])).toEqual(['instagram']);
  });
});

describe('pruneRequestedPlatforms', () => {
  it('clears a channel once it is connected', () => {
    expect(pruneRequestedPlatforms(['whatsapp', 'web'], { ...empty, web: true })).toEqual(['whatsapp']);
  });

  it('returns empty when every requested channel is live', () => {
    expect(
      pruneRequestedPlatforms(['facebook', 'instagram'], { ...empty, facebook: true, instagram: true }),
    ).toEqual([]);
  });
});

describe('channelLimitMessage', () => {
  it('uses the one-channel copy on free', () => {
    expect(channelLimitMessage(1)).toMatch(/one channel/);
  });
});
