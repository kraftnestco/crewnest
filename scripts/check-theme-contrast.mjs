/**
 * Contrast audit for the ClerkNest palette in `globals.css`.
 *
 * The theme is authored in OKLCH, but WCAG ratios are defined on sRGB relative
 * luminance — so a pair that looks safe in OKLCH lightness can still fail. This
 * converts each token to sRGB and checks the pairs that carry real text.
 *
 * Run: node scripts/check-theme-contrast.mjs
 */

function oklchToRgb(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const lin = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  return lin.map((v) => Math.min(1, Math.max(0, v)));
}

/** WCAG relative luminance is defined on linearized channels, which is what oklchToRgb returns. */
function relativeLuminance([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Linear light -> gamma-encoded sRGB, for the hex previews only. */
function encode(v) {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

function contrast(fg, bg) {
  const a = relativeLuminance(oklchToRgb(...fg));
  const b = relativeLuminance(oklchToRgb(...bg));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function hex(token) {
  return (
    '#' +
    oklchToRgb(...token)
      .map((v) => Math.round(encode(v) * 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

const light = {
  background: [0.979, 0.007, 88.6],
  surface: [0.935, 0.016, 84],
  foreground: [0.196, 0.011, 60.7],
  card: [1, 0, 0],
  primary: [0.574, 0.218, 10],
  primaryForeground: [0.985, 0.005, 90],
  mutedForeground: [0.515, 0.015, 65],
  destructive: [0.52, 0.19, 33],
  sidebar: [0.935, 0.016, 84],
  sidebarForeground: [0.27, 0.015, 62],
  successText: [0.45, 0.11, 160],
  successTint: [0.95, 0.03, 160],
  pendingText: [0.5, 0.11, 68],
  pendingTint: [0.955, 0.04, 82],
  dangerText: [0.5, 0.18, 32],
  dangerTint: [0.95, 0.03, 32],
  stageInk: [0.151, 0.006, 68],
  stagePrimary: [0.66, 0.17, 8],
};

const dark = {
  background: [0.151, 0.006, 68],
  surface: [0.151, 0.006, 68],
  foreground: [0.96, 0.005, 88],
  card: [0.196, 0.011, 61],
  primary: [0.66, 0.17, 8],
  primaryForeground: [0.16, 0.012, 60],
  mutedForeground: [0.7, 0.014, 70],
  destructive: [0.7, 0.18, 33],
  sidebar: [0.175, 0.008, 64],
  sidebarForeground: [0.94, 0.008, 88],
  successText: [0.8, 0.13, 162],
  successTint: [0.28, 0.04, 162],
  pendingText: [0.85, 0.12, 80],
  pendingTint: [0.28, 0.05, 75],
  dangerText: [0.78, 0.15, 30],
  dangerTint: [0.29, 0.06, 30],
  stageInk: [0.151, 0.006, 68],
  stagePrimary: [0.66, 0.17, 8],
};

const PAIRS = [
  ['body text', 'foreground', 'background'],
  ['body text on card', 'foreground', 'card'],
  ['body text on canvas', 'foreground', 'surface'],
  ['muted text', 'mutedForeground', 'background'],
  ['muted text on card', 'mutedForeground', 'card'],
  ['primary button label', 'primaryForeground', 'primary'],
  ['destructive button label', 'primaryForeground', 'destructive'],
  // `text-primary` is used ~38x as accent text/icons, not just as a button fill.
  ['accent text on page', 'primary', 'background'],
  ['accent text on card', 'primary', 'card'],
  ['sidebar text', 'sidebarForeground', 'sidebar'],
  ['CTA on marketing stage', 'stagePrimary', 'stageInk'],
  ['success badge', 'successText', 'successTint'],
  ['pending badge', 'pendingText', 'pendingTint'],
  ['danger badge', 'dangerText', 'dangerTint'],
];

let failures = 0;

for (const [name, theme] of [
  ['LIGHT', light],
  ['DARK', dark],
]) {
  console.log(`\n${name}`);
  for (const [label, fgKey, bgKey] of PAIRS) {
    const ratio = contrast(theme[fgKey], theme[bgKey]);
    const ok = ratio >= 4.5;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'}  ${ratio.toFixed(2)}:1  ${label}  (${hex(theme[fgKey])} on ${hex(theme[bgKey])})`,
    );
  }

  // Brand pink and destructive red sit near each other on the hue wheel, so a
  // "Save" button must not be mistakable for a "Delete" one.
  const hueGap = Math.abs(theme.primary[2] - theme.destructive[2]);
  const lightnessGap = Math.abs(theme.primary[0] - theme.destructive[0]);
  console.log(
    `  ---  primary ${hex(theme.primary)} vs destructive ${hex(theme.destructive)}: ` +
      `${hueGap.toFixed(1)}deg hue, ${lightnessGap.toFixed(2)} lightness apart`,
  );
}

console.log(failures === 0 ? '\nAll text pairs clear 4.5:1.' : `\n${failures} pair(s) below 4.5:1.`);
process.exit(failures === 0 ? 0 : 1);
