import type { NextConfig } from "next";

/**
 * Baseline security headers.
 *
 * Deliberately NOT applied to `/embed/:path*` or `/api/:path*`: the chat widget
 * is loaded by third-party sites by design (that's the whole product surface),
 * and the widget/config routes already run their own origin allow-list plus
 * explicit CORS handling. Framing protection is scoped to the app's own pages,
 * where clickjacking a logged-in agency/tenant dashboard is the real risk.
 *
 * No Content-Security-Policy here on purpose — a CSP added blind would either be
 * so loose it means nothing, or would break Next's inline bootstrap scripts and
 * the Shadow-DOM widget's inline styles. That needs its own pass with a report-only
 * rollout, not a guess bundled into a header fix.
 */
const SECURITY_HEADERS = [
  // HSTS. Vercel terminates TLS and already redirects http→https; this makes the
  // browser refuse plaintext for a year, closing the first-request downgrade window.
  // No `preload` — that's a one-way submission that shouldn't be made implicitly.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Clickjacking: the dashboards carry destructive one-click actions (Take Over,
  // erase customer, cancel subscription). frame-ancestors is the modern control;
  // X-Frame-Options stays for older browsers that ignore it.
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Stops a browser from MIME-sniffing a response into something executable.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full dashboard URLs (which carry session/order ids in query
  // strings, e.g. /admin/chat?session=<uuid>) to third-party sites.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No page in this app uses camera/mic/geolocation; deny them outright.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
];

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/",
          destination: "/clerknest-assets/index.html",
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        // Everything except the cross-origin embed surface and the API routes.
        source: "/((?!embed|api).*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
