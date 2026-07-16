import 'server-only';
import { randomUUID } from 'node:crypto';
import { env } from '@/lib/env';
import {
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MEDIA_ALLOWED_MIME,
  MEDIA_SIGNED_URL_TTL_SECONDS,
  META_GRAPH_BASE,
  ORDER_MEDIA_BUCKET,
} from '@/lib/constants';
import { getMetaToken } from '@/lib/secrets';
import { createServiceClient } from '@/lib/supabase/service';
import type { AttachmentKind, InboundAttachment, Platform, Tenant } from '@/types/domain';

/**
 * Download an inbound WhatsApp/Messenger/Instagram attachment server-side and
 * persist it to the private `order-media` bucket. See docs/10 §4.1/§7.
 *
 * WhatsApp media ids require a two-step authenticated fetch (resolve the CDN
 * url, then fetch it, both with the tenant's WA token); Messenger/IG hand us
 * an already time-limited CDN url directly. Caps (MIME allow-list + max
 * bytes) are enforced on the response STREAM, before it is fully buffered.
 *
 * Never throws — a download failure or cap violation returns null so the
 * caller can skip this one attachment without failing the whole customer
 * turn. Logs metadata only, never a token or raw media URL.
 */
export async function download(
  attachment: InboundAttachment,
  tenant: Pick<Tenant, 'id' | 'metaTokenSecretId' | 'whatsappTokenSecretId'>,
  sessionId: string,
  platform: Platform,
): Promise<{ storagePath: string; mimeType: string } | null> {
  try {
    const fetched = await fetchAttachmentBytes(attachment, tenant, platform);
    if (!fetched) return null;

    const mimeType = fetched.mimeType ?? attachment.mimeType ?? fallbackMime(attachment.kind);
    if (!MEDIA_ALLOWED_MIME[attachment.kind].includes(mimeType)) {
      console.warn(`[media] rejected mime "${mimeType}" for kind ${attachment.kind} (tenant ${tenant.id})`);
      return null;
    }

    const storagePath = `${tenant.id}/${sessionId}/${randomUUID()}.${extensionFor(mimeType)}`;
    const svc = createServiceClient();
    const { error } = await svc.storage
      .from(ORDER_MEDIA_BUCKET)
      .upload(storagePath, fetched.bytes, { contentType: mimeType, upsert: false });
    if (error) {
      console.warn(`[media] storage upload failed (tenant ${tenant.id}): ${error.message}`);
      return null;
    }

    return { storagePath, mimeType };
  } catch (err) {
    console.warn(`[media] download failed (tenant ${tenant.id}):`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Mint a short-TTL signed URL for the model (multimodal turn) or dashboard (previews) to read private media. */
export async function getSignedUrl(storagePath: string): Promise<string | null> {
  const svc = createServiceClient();
  const { data, error } = await svc.storage
    .from(ORDER_MEDIA_BUCKET)
    .createSignedUrl(storagePath, MEDIA_SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    console.warn(`[media] signed url failed for ${storagePath}: ${error?.message}`);
    return null;
  }
  return data.signedUrl;
}

// --- fetch, capped before buffering ------------------------------------------

const MAX_BYTES_BY_KIND: Record<AttachmentKind, number> = {
  image: MAX_IMAGE_BYTES,
  audio: MAX_AUDIO_BYTES,
  video: MAX_VIDEO_BYTES,
};

async function fetchAttachmentBytes(
  attachment: InboundAttachment,
  tenant: Pick<Tenant, 'metaTokenSecretId' | 'whatsappTokenSecretId'>,
  platform: Platform,
): Promise<{ bytes: Uint8Array; mimeType: string | null } | null> {
  const maxBytes = MAX_BYTES_BY_KIND[attachment.kind];

  if (platform === 'whatsapp') {
    if (!attachment.mediaId) return null;
    const token = await getMetaToken(tenant, 'whatsapp');
    if (!token) return null;

    // Step 1: authenticated GET resolves a time-limited CDN url + declared mime type.
    const metaRes = await fetch(`${META_GRAPH_BASE}/${env.META_GRAPH_VERSION}/${attachment.mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) return null;
    const metaJson = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!metaJson.url) return null;

    // Step 2: fetch the bytes — WhatsApp's media CDN also requires the bearer token.
    const bytes = await fetchCapped(metaJson.url, { Authorization: `Bearer ${token}` }, maxBytes);
    return bytes ? { bytes, mimeType: metaJson.mime_type ?? null } : null;
  }

  // Messenger/IG: payload.url is already a pre-authenticated, time-limited CDN link.
  if (!attachment.url) return null;
  const bytes = await fetchCapped(attachment.url, {}, maxBytes);
  return bytes ? { bytes, mimeType: null } : null;
}

/** Streams the body, aborting the instant it exceeds `maxBytes` — a Content-Length header alone is never trusted. */
async function fetchCapped(
  url: string,
  headers: Record<string, string>,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const res = await fetch(url, { headers });
  if (!res.ok || !res.body) return null;

  const declaredLength = Number(res.headers.get('content-length') ?? '0');
  if (declaredLength > maxBytes) return null;

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/amr': 'amr',
  'audio/wav': 'wav',
  'audio/aac': 'aac',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
};

function extensionFor(mimeType: string): string {
  return EXT_BY_MIME[mimeType] ?? 'bin';
}

function fallbackMime(kind: AttachmentKind): string {
  return kind === 'image' ? 'image/jpeg' : kind === 'audio' ? 'audio/ogg' : 'video/mp4';
}
