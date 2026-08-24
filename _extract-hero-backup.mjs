import fs from "fs";
import path from "path";

const root = "c:/Users/Admin/Desktop/crewnest";
const html = fs.readFileSync(`${root}/public/clerknest-assets/index.html`, "utf8");
const landing = fs.readFileSync(`${root}/public/clerknest-assets/landing-links.js`, "utf8");
const backupDir = `${root}/public/clerknest-assets/_hero-backup`;
fs.mkdirSync(backupDir, { recursive: true });

// Extract hero-related CSS snippets from bundle inline styles
const heroPatterns = [
  /hero-photo[^}]{0,800}/g,
  /hero-mesh[^}]{0,800}/g,
  /data-navtheme[^}]{0,400}/g,
  /url\([^)]+\)/g,
];
const urls = [...new Set([...html.matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map((m) => m[2]))];
const heroUrls = urls.filter((u) =>
  /hero|mobile|box|cardboard|clerknest|shop|ecom|platform|mesh|photo/i.test(u),
);

// Extract hero class rules from bundle style block (first 200k of style tag)
const styleMatch = html.match(/<style>([\s\S]{0,500000})<\/style>/);
let bundleHeroCss = "";
if (styleMatch) {
  const css = styleMatch[1];
  const rules = css.match(/[^{]*(?:hero-photo|hero-mesh|cn-mobile-hero|data-navtheme)[^{]*\{[^}]*\}/g) || [];
  bundleHeroCss = rules.join("\n\n");
}

// Snapshot landing-links hero section (lines ~1008-1448 and applyHeroLayout)
const heroStart = landing.indexOf("Mobile first fold — dark hero");
const heroEnd = landing.indexOf("Multi-channel intelligence", heroStart);
const heroSnippet = heroStart >= 0 ? landing.slice(Math.max(0, heroStart - 200), heroEnd) : "";
const applyStart = landing.indexOf("const applyHeroLayout");
const applyEnd = landing.indexOf("ensureHeroLayoutStyle();", applyStart);
const applySnippet = applyStart >= 0 ? landing.slice(applyStart, applyEnd + 30) : "";

fs.writeFileSync(`${backupDir}/bundle-hero-css-snippet.css`, bundleHeroCss || "/* No hero rules matched in bundle */");
fs.writeFileSync(`${backupDir}/landing-links-hero-snippet-backup.js`, heroSnippet + "\n\n// --- applyHeroLayout ---\n\n" + applySnippet);
fs.writeFileSync(
  `${backupDir}/notes.txt`,
  `ClerkNest hero backup — ${new Date().toISOString()}

MOBILE TREATMENT (landing-links.js + mobilehero.png):
- landing-links.js applies .cn-mobile-hero class and injects cn-mobile-hero-layout-v13 CSS
- Mobile (max-width 1023px): dark bg #0d0b09, white ivory text, mobilehero.png as .hero-photo
- Photo is darkened with gradient scrim; hero-visual (desktop dashboard) hidden on mobile
- ManyChat-style bubble demo (.cn-mobile-bubbles) shows multi-channel AI story
- Platform strip kept under CTAs (Social Media Automation Platform + overlapping icons)

DESKTOP/LAPTOP TREATMENT (prebuilt bundle index.html):
- Same section gets .cn-mobile-hero class but desktop rules differ:
  - .cn-mobile-bubbles hidden at min-width 1024px
  - .cn-hero-visual visible — shows chat + dashboard demo panel (crowded collage feel)
  - Bundle ships dark hero with hero-photo, hero-mesh, bubble-deco decorative elements
  - Dark photo collage with ecom/social props (cardboard boxes, platform icons) — user finds too crowded

REFERENCED ASSETS:
${heroUrls.length ? heroUrls.map((u) => "- " + u).join("\n") : "- (none extracted from bundle)"}

LOCAL FILES CHECK:
- mobilehero.png referenced at /clerknest-assets/mobilehero.png — may be gitignored or deploy-only
- logo.png referenced at /clerknest-assets/logo.png

BACKUP FILES IN THIS FOLDER:
- landing-links-hero-snippet-backup.js — hero CSS injection + applyHeroLayout from landing-links.js
- bundle-hero-css-snippet.css — hero-related rules extracted from prebuilt bundle
- notes.txt — this file
`,
);

console.log("Backup written to", backupDir);
console.log("Hero URLs:", heroUrls);
