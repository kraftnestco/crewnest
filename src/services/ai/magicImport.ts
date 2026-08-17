import 'server-only';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { getProvider } from './provider';
import { getLlmKey } from '@/lib/secrets';
import { estimateCostUsd } from './pricing';
import { composeSystemPrompt } from './promptArchitect';
import { createServiceClient } from '@/lib/supabase/service';
import type { Tenant } from '@/types/domain';
import type { Json } from '@/types/database';
import type { MagicImportFields } from '@/components/intake/intake-shared';

/**
 * Magic Import (docs/19 O2). The owner pastes their website/social URL; we fetch
 * it server-side, extract a structured business profile, and pre-fill the entire
 * intake wizard for a one-click confirm — the "paste a link, live in minutes"
 * onboarding non-technical clients actually complete (Tidio Lyro validated this,
 * docs/19 research §2).
 *
 * Extraction is deliberately conservative: it transcribes only what's on the page
 * and NEVER invents prices, items, hours, or policies. The persona is composed by
 * the O1 Prompt Architect (reused), so imported and hand-built tenants get the
 * same persona quality. Nothing is persisted here — the owner reviews every step
 * and the existing intake save is the only write.
 */

export interface MagicImportOutcome {
  fields: MagicImportFields;
  summary: string;
}

const MAX_HTML_BYTES = 1_500_000;
const MAX_TEXT_CHARS = 12_000;
const MAX_REDIRECTS = 4;
const FETCH_TIMEOUT_MS = 8_000;

/* ------------------------------------------------------------------ SSRF guard */

function ipToBytes(ip: string): number[] | null {
  const v = net.isIP(ip);
  if (v === 4) return ip.split('.').map((o) => Number(o));
  return null;
}

/** Blocks loopback, private, link-local, CGNAT, and unspecified addresses (v4 + common v6). */
function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 0) return true; // not an IP literal — treat as unresolved/unsafe
  if (family === 4) {
    const b = ipToBytes(ip);
    if (!b) return true;
    const [a, c] = b;
    if (a === 0 || a === 127 || a === 10) return true; // this-network, loopback, private
    if (a === 169 && c === 254) return true; // link-local
    if (a === 172 && c >= 16 && c <= 31) return true; // private
    if (a === 192 && c === 168) return true; // private
    if (a === 100 && c >= 64 && c <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::' ) return true; // loopback / unspecified
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true; // link-local / ULA
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return isBlockedAddress(mapped[1]);
  return false;
}

/** Validates a single URL is a public http(s) endpoint (resolves DNS, checks the resolved IP). */
async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('That doesn\'t look like a valid web address.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Only http and https links can be imported.');
  }
  const host = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) {
    throw new Error('That address is not reachable.');
  }
  // If the host is already an IP literal, check it directly; otherwise resolve it.
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw new Error('That address is not reachable.');
    return u;
  }
  const { address } = await lookup(host);
  if (isBlockedAddress(address)) throw new Error('That address is not reachable.');
  return u;
}

/**
 * Fetches the page text with a bounded, per-hop-validated redirect follow so a
 * public URL can't 30x-bounce into an internal address (SSRF). Reads <title> +
 * meta description before stripping tags.
 */
async function fetchSiteText(rawUrl: string): Promise<string> {
  let current = rawUrl;
  let html = '';
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'user-agent': 'ClerkNestBot/1.0 (+business onboarding importer)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new Error('Could not read that page.');
      current = new URL(location, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`Could not read that page (status ${res.status}).`);
    const buf = await res.arrayBuffer();
    html = new TextDecoder('utf-8').decode(buf.slice(0, MAX_HTML_BYTES));
    break;
  }
  if (!html) throw new Error('That page kept redirecting — try a direct link.');

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '';
  const metaDesc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]?.trim() ?? '';

  const body = htmlToText(html).slice(0, MAX_TEXT_CHARS);
  const parts = [title && `Page title: ${title}`, metaDesc && `Meta description: ${metaDesc}`, '', body].filter(
    (p) => p !== undefined,
  );
  const text = parts.join('\n').trim();
  if (text.replace(/\s/g, '').length < 40) {
    throw new Error("We couldn't find readable text on that page — try your main page or an About page.");
  }
  return text;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n')
    .trim();
}

/* --------------------------------------------------------------- LLM extraction */

const EXTRACTION_SYSTEM_PROMPT = `You read the text of a small business's website or social page and extract a structured profile. Output ONLY a JSON object, no prose, no markdown fences.

Shape (every key required; use "" or [] when the page does not clearly state something):
{
  "businessType": "product" | "service",
  "businessSummary": "one plain sentence describing what the business does",
  "tone": "friendly" | "professional" | "playful" | "premium",
  "catalogue": "the products/services and their prices, transcribed in plain lines exactly as stated on the page (e.g. 'Chocolate cake - Rs 2500'); empty string if none are listed",
  "delivery": "delivery/shipping info if stated, else \"\"",
  "returns": "returns/refund/exchange policy if stated, else \"\"",
  "location": "physical address or service area if stated, else \"\"",
  "hours": "opening hours if stated, in plain text, else \"\"",
  "faq": [ { "q": "question", "a": "answer" } ],
  "notes": "any other short useful fact for the assistant (e.g. languages, lead times), else \"\""
}

Rules:
- Extract ONLY what the page actually states. NEVER invent or guess prices, items, hours, policies, phone numbers, or addresses. When unsure, leave the field empty.
- "businessType": choose "service" for salons/clinics/agencies/tutors/repairs/anything appointment- or quote-based; "product" for shops selling physical items.
- "tone": infer the brand's voice from the copy.
- "catalogue": preserve prices and item names exactly as written; do not normalise currencies or make up prices.
- "faq": only include genuine question/answer pairs supported by the page; otherwise return [].`;

interface Extracted {
  businessType: 'product' | 'service';
  businessSummary: string;
  tone: string;
  catalogue: string;
  delivery: string;
  returns: string;
  location: string;
  hours: string;
  faq: { q: string; a: string }[];
  notes: string;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function parseExtraction(text: string): Extracted {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  let obj: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>;
  } catch {
    // leave obj empty → everything falls back to safe defaults below
  }
  const faqRaw = Array.isArray(obj.faq) ? obj.faq : [];
  const faq = faqRaw
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
    .map((e) => ({ q: str(e.q), a: str(e.a) }))
    .filter((e) => e.q && e.a);
  return {
    businessType: obj.businessType === 'service' ? 'service' : 'product',
    businessSummary: str(obj.businessSummary),
    tone: str(obj.tone) || 'friendly',
    catalogue: str(obj.catalogue),
    delivery: str(obj.delivery),
    returns: str(obj.returns),
    location: str(obj.location),
    hours: str(obj.hours),
    faq,
    notes: str(obj.notes),
  };
}

async function extractProfile(
  tenant: Pick<Tenant, 'id' | 'openaiKeySecretId' | 'llmProvider' | 'llmModel'>,
  siteText: string,
): Promise<Extracted> {
  const { key, usedByok } = await getLlmKey(tenant);
  const provider = getProvider(tenant.llmProvider);
  const result = await provider.chat(
    {
      model: tenant.llmModel,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: siteText },
      ],
      temperature: 0.2,
      maxTokens: 2000,
    },
    key,
  );

  const client = createServiceClient();
  await client.from('usage_logs').insert({
    tenant_id: tenant.id,
    session_id: null,
    provider: tenant.llmProvider,
    model: tenant.llmModel,
    prompt_tokens: result.usage.promptTokens,
    completion_tokens: result.usage.completionTokens,
    total_tokens: result.usage.totalTokens,
    estimated_cost_usd: estimateCostUsd(result.usage, tenant.llmModel),
    used_byok: usedByok,
  });

  return parseExtraction(result.text);
}

/* ------------------------------------------------------------------- orchestrate */

export async function magicImportFromUrl(
  tenant: Pick<Tenant, 'id' | 'businessName' | 'openaiKeySecretId' | 'llmProvider' | 'llmModel'>,
  rawUrl: string,
): Promise<MagicImportOutcome> {
  const siteText = await fetchSiteText(rawUrl);
  const profile = await extractProfile(tenant, siteText);

  // Reuse the O1 Prompt Architect so imported personas match hand-built ones.
  const systemPrompt = await composeSystemPrompt(tenant, {
    businessName: tenant.businessName,
    businessType: profile.businessType,
    businessSummary: profile.businessSummary,
    tone: profile.tone,
    catalogueHint: profile.catalogue,
  });

  const noteParts = [profile.hours && `Hours: ${profile.hours}`, profile.notes].filter(Boolean);
  const knowledge = {
    faq: profile.faq,
    delivery: profile.delivery,
    returns: profile.returns,
    location: profile.location,
    note: noteParts.join('\n'),
  };
  const hasKnowledge = Boolean(
    profile.delivery || profile.returns || profile.location || knowledge.note || profile.faq.length,
  );

  const fields: MagicImportFields = {
    business_type: profile.businessType,
    system_prompt: systemPrompt,
  };
  if (profile.catalogue) fields.catalog_freeform_text = profile.catalogue;
  if (hasKnowledge) fields.knowledge_base = knowledge as unknown as Json;

  const foundBits = [
    profile.catalogue ? 'a catalogue draft' : null,
    profile.faq.length ? `${profile.faq.length} FAQ${profile.faq.length > 1 ? 's' : ''}` : null,
    profile.delivery ? 'delivery info' : null,
    profile.returns ? 'a returns policy' : null,
    profile.location ? 'a location' : null,
    profile.hours ? 'opening hours' : null,
  ].filter(Boolean);
  const summary = foundBits.length
    ? `We read your page and filled in: ${foundBits.join(', ')}, plus a suggested persona. Review each step and confirm — nothing is saved until you finish.`
    : 'We read your page and drafted a persona for you. Add your catalogue and details in the steps below, then confirm.';

  return { fields, summary };
}
