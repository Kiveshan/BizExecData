/**
 * Generates the README diagrams as static SVG, one file per colour scheme.
 *
 *   node docs/generate-diagrams.mjs
 *
 * The README embeds them with <picture> + prefers-color-scheme, so GitHub
 * swaps light/dark automatically. Both themes come from one layout definition
 * below — edit the layout once and re-run to keep the pair in sync.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

const SANS = '-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif';
const MONO = 'ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace';

/** GitHub's own light/dark palettes, so the diagrams sit naturally in the page. */
const THEMES = {
  light: {
    bg: "#ffffff",
    card: "#f6f8fa",
    panel: "#ffffff",
    border: "#d1d9e0",
    fg: "#1f2328",
    muted: "#59636e",
    edge: "#818b98",
    qb: "#1a7f37",
    xero: "#0969da",
    sage: "#8250df",
    excel: "#bc4c00",
    store: "#cf222e",
  },
  dark: {
    bg: "#0d1117",
    card: "#161b22",
    panel: "#0d1117",
    border: "#3d444d",
    fg: "#e6edf3",
    muted: "#9198a1",
    edge: "#6e7681",
    qb: "#3fb950",
    xero: "#58a6ff",
    sage: "#bc8cff",
    excel: "#f0883e",
    store: "#ff7b72",
  },
};

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

const defs = (t) => `  <defs>
    <marker id="arw" viewBox="0 0 9 9" refX="8" refY="4.5" markerWidth="9" markerHeight="9"
            markerUnits="userSpaceOnUse" orient="auto-start-reverse">
      <path d="M0,0 L9,4.5 L0,9 Z" fill="${t.edge}"/>
    </marker>
    <marker id="arw-err" viewBox="0 0 9 9" refX="8" refY="4.5" markerWidth="9" markerHeight="9"
            markerUnits="userSpaceOnUse" orient="auto-start-reverse">
      <path d="M0,0 L9,4.5 L0,9 Z" fill="${t.store}"/>
    </marker>
  </defs>`;

const style = (t) => `  <style>
    .c    { fill: ${t.card}; stroke: ${t.border}; stroke-width: 1; }
    .p    { fill: ${t.panel}; stroke: ${t.border}; stroke-width: 1; }
    .ttl  { font: 600 13.5px ${SANS}; fill: ${t.fg}; }
    .ttlm { font: 600 11.5px ${MONO}; fill: ${t.fg}; }
    .sub  { font: 400 10px ${SANS}; fill: ${t.muted}; }
    .code { font: 400 9.5px ${MONO}; fill: ${t.muted}; }
    .gut  { font: 600 10.5px ${SANS}; fill: ${t.muted}; letter-spacing: .09em; }
    .lbl  { font: 400 9.5px ${SANS}; fill: ${t.muted}; }
    .e    { fill: none; stroke: ${t.edge}; stroke-width: 1.5; marker-end: url(#arw); }
    .en   { fill: none; stroke: ${t.edge}; stroke-width: 1.5; }
    .ed   { stroke-dasharray: 5 4; }
    .err  { stroke: ${t.store}; marker-end: url(#arw-err); }
    .errt { fill: ${t.store}; }
  </style>`;

const card = (x, y, w, h, cls = "c") =>
  `  <rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="10"/>`;

/** Small colour tab at the top of a card, used to key the provider lanes. */
const tab = (x, w, y, colour) =>
  `  <rect x="${x + 12}" y="${y}" width="${w - 24}" height="3" rx="1.5" fill="${colour}"/>`;

const txt = (x, y, s, cls = "sub", anchor = "middle", extra = "") =>
  `  <text x="${x}" y="${y}" class="${cls}" text-anchor="${anchor}"${extra}>${esc(s)}</text>`;

const svg = (w, h, t, title, body) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"
     role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>
${style(t)}
${defs(t)}
  <rect width="${w}" height="${h}" fill="${t.bg}"/>
${body}
</svg>
`;

// ---------------------------------------------------------------------------
// diagram 1 — architecture
// ---------------------------------------------------------------------------

const PROVIDERS = [
  { x: 416, key: "qb", name: "QuickBooks", lines: ["OAuth 2.0", "tokens in DB", "refresh at −60 s"], api: "ProfitAndLoss · Detail" },
  { x: 570, key: "xero", name: "Xero", lines: ["OAuth 2.0", "tokenSet in session", "SDK-managed refresh"], api: "getReportProfitAndLoss" },
  { x: 724, key: "sage", name: "Sage", lines: ["HTTP Basic", "AES-256-CBC creds", "held in session"], api: "ProfitAndLoss/Get" },
  { x: 878, key: "excel", name: "Excel / TXT", lines: ["no auth", "fixed template", ".xlsx · .xltx · .txt"], api: "uploads/IS.xltx" },
];

function architecture(t) {
  const o = [];
  const PW = 142;
  const PY = 312;
  const PH = 150;

  // stage labels down the left gutter
  for (const [label, y] of [
    ["BROWSER", 82], ["EXPRESS APP", 224], ["PROVIDERS", 391],
    ["EXTRACTION", 572], ["STORAGE", 718],
  ]) {
    o.push(txt(140, y, label, "gut", "end"));
  }

  // row 1 — browser
  o.push(card(160, 40, 210, 76));
  o.push(txt(265, 74, "Loading page", "ttl"));
  o.push(txt(265, 96, "polls extraction progress"));
  o.push(card(416, 40, 604, 76));
  o.push(txt(718, 74, "Provider dashboards", "ttl"));
  o.push(txt(718, 96, "EJS · Chart.js · D3 — one view set per source"));

  // row 2 — express
  o.push(card(416, 176, 280, 88));
  o.push(txt(556, 206, "Route modules", "ttl"));
  o.push(txt(556, 228, "auth · user · admin"));
  o.push(txt(556, 246, "quickbooks · xero · sage · excel"));
  o.push(card(822, 176, 198, 88));
  o.push(txt(921, 206, "JSON endpoints", "ttl"));
  o.push(txt(921, 228, "/api/*", "code"));
  o.push(txt(921, 246, "dashboard reads"));

  // row 3 — provider lanes
  for (const p of PROVIDERS) {
    const cx = p.x + PW / 2;
    o.push(card(p.x, PY, PW, PH));
    o.push(tab(p.x, PW, PY, t[p.key]));
    o.push(txt(cx, 342, p.name, "ttl", "middle", ` fill="${t[p.key]}"`));
    o.push(txt(cx, 368, p.lines[0]));
    o.push(txt(cx, 386, p.lines[1]));
    o.push(txt(cx, 404, p.lines[2]));
    o.push(txt(cx, 430, p.api, "code"));
  }

  // row 4 — extraction
  o.push(card(160, 524, 210, 88));
  o.push(txt(265, 554, "extractionStatus", "ttl"));
  o.push(txt(265, 578, "in-memory progress map"));
  o.push(txt(265, 596, "cleared one hour later"));
  o.push(card(416, 524, 280, 88));
  o.push(txt(556, 554, "Per-provider extractor", "ttl"));
  o.push(txt(556, 578, "sequential, month by month"));
  o.push(txt(556, 596, "3 years first run · 1 year after"));
  o.push(card(740, 524, 280, 88));
  o.push(txt(880, 554, "Normaliser", "ttl"));
  o.push(txt(880, 578, "{ category, amount, date }", "code"));
  o.push(txt(880, 596, "+ five-field monthly calc"));

  // row 5 — storage
  o.push(card(568, 676, 300, 76));
  o.push(txt(718, 708, "PostgreSQL", "ttl", "middle", ` fill="${t.store}"`));
  o.push(txt(718, 730, "per-provider tables · Prisma + pg"));

  // edges
  o.push(`  <path class="e" d="M556,116 V176"/>`);
  o.push(txt(564, 150, "connect / extract", "lbl", "start"));
  o.push(`  <path class="e" d="M921,116 V176"/>`);
  o.push(txt(929, 150, "read", "lbl", "start"));

  // fan-out: routes -> four provider lanes, over a shared rail
  o.push(`  <path class="en" d="M556,264 V288"/>`);
  o.push(`  <path class="en" d="M487,288 H949"/>`);
  for (const p of PROVIDERS) o.push(`  <path class="e" d="M${p.x + PW / 2},288 V${PY}"/>`);

  // fan-in: four lanes -> extractor, over a shared rail
  for (const p of PROVIDERS) o.push(`  <path class="en" d="M${p.x + PW / 2},${PY + PH} V492"/>`);
  o.push(`  <path class="en" d="M487,492 H949"/>`);
  o.push(`  <path class="e" d="M556,492 V524"/>`);

  o.push(`  <path class="e" d="M696,568 H740"/>`);
  o.push(`  <path class="e" d="M880,612 V636 A8,8 0 0,1 872,644 H726 A8,8 0 0,0 718,652 V676"/>`);

  // progress side-channel
  o.push(`  <path class="e ed" d="M265,116 V524"/>`);
  o.push(txt(273, 326, "poll", "lbl", "start"));
  o.push(`  <path class="e ed" d="M416,568 H370"/>`);
  o.push(txt(393, 558, "writes", "lbl"));

  // dashboard read path, routed clear of everything on the right
  o.push(`  <path class="e" d="M1020,220 H1052 A8,8 0 0,1 1060,228 V706 A8,8 0 0,1 1052,714 H868"/>`);
  o.push(txt(960, 706, "read queries", "lbl"));

  return svg(1100, 800, t, "BizExecData architecture", o.join("\n"));
}

// ---------------------------------------------------------------------------
// diagram 2 — QuickBooks token lifecycle (sequence)
// ---------------------------------------------------------------------------

const ACTORS = [
  { cx: 120, x: 45, w: 150, name: "Extractor", file: "quickbooks/extractor.js", mono: false },
  { cx: 390, x: 275, w: 230, name: "makeQuickBooksApiCall", file: "quickbooks/client.js", mono: true },
  { cx: 660, x: 550, w: 220, name: "quickbooks_oauth_token", file: "PostgreSQL", mono: true },
  { cx: 905, x: 830, w: 150, name: "Intuit API", file: "OAuth + Accounting", mono: false },
];

const [EX, CL, DB, QB] = ACTORS.map((a) => a.cx);

function msg(from, to, y, label, { dashed = false, error = false } = {}) {
  const cls = ["e", dashed ? "ed" : "", error ? "err" : ""].filter(Boolean).join(" ");
  const mid = (from + to) / 2;
  return [
    `  <path class="${cls}" d="M${from},${y} H${to}"/>`,
    txt(mid, y - 7, label, error ? "lbl errt" : "lbl"),
  ].join("\n");
}

/** Labelled fragment box, the equivalent of an alt/opt block. */
function frag(x, y, w, h, label) {
  // 10.5px semibold sans with .09em tracking measures ≈7.3px per character
  const tw = label.length * 7.3 + 20;
  return [
    `  <rect class="p" x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="none"/>`,
    `  <path class="p" d="M${x},${y + 6} a6,6 0 0,1 6,-6 H${x + tw} l0,18 H${x + 6} a6,6 0 0,1 -6,-6 Z"/>`,
    txt(x + 9, y + 13, label, "gut", "start"),
  ].join("\n");
}

function divider(x, w, y, label) {
  return [
    `  <path class="en ed" d="M${x},${y} H${x + w}"/>`,
    txt(x + 9, y + 14, `[ ${label} ]`, "gut", "start"),
  ].join("\n");
}

function tokenLifecycle(t) {
  const o = [];
  const BOTTOM = 704;

  for (const a of ACTORS) {
    o.push(`  <path class="en ed" d="M${a.cx},76 V${BOTTOM}"/>`);
    o.push(card(a.x, 24, a.w, 52));
    o.push(txt(a.cx, 48, a.name, a.mono ? "ttlm" : "ttl"));
    o.push(txt(a.cx, 65, a.file, "code"));
  }

  o.push(msg(EX, CL, 112, "request P&L report"));
  o.push(msg(CL, DB, 146, "load token row"));
  o.push(msg(DB, CL, 178, "token row or null", { dashed: true }));

  o.push(frag(30, 200, 490, 58, "OPT · NO STORED TOKEN"));
  o.push(msg(CL, EX, 242, "throw QB_RECONNECT_REQUIRED", { dashed: true, error: true }));

  o.push(card(265, 276, 250, 34, "p"));
  o.push(txt(390, 297, "refresh when within 60 s of expires_at"));

  o.push(frag(260, 322, 730, 112, "OPT · REFRESH NEEDED"));
  o.push(msg(CL, QB, 356, "oauthClient.refresh()"));
  o.push(msg(QB, CL, 388, "rotated access + refresh token", { dashed: true }));
  o.push(msg(CL, DB, 420, "upsert rotated token"));

  o.push(msg(CL, QB, 466, "makeApiCall(options)"));

  o.push(frag(30, 488, 960, 216, "ALT · SUCCESS"));
  o.push(msg(QB, CL, 522, "report JSON + intuit_tid header", { dashed: true }));
  o.push(msg(CL, EX, 550, "response", { dashed: true }));

  o.push(divider(30, 960, 566, "invalid_grant"));
  o.push(msg(CL, DB, 594, "delete token row"));
  o.push(msg(CL, EX, 622, "throw QB_RECONNECT_REQUIRED", { dashed: true, error: true }));

  o.push(divider(30, 960, 634, "transient error"));
  o.push(msg(CL, QB, 662, "refreshIfNeeded, then retry once"));
  o.push(msg(QB, CL, 690, "response", { dashed: true }));

  return svg(1020, 740, t, "QuickBooks token lifecycle", o.join("\n"));
}

// ---------------------------------------------------------------------------

for (const [name, theme] of Object.entries(THEMES)) {
  writeFileSync(join(OUT_DIR, `architecture-${name}.svg`), architecture(theme));
  writeFileSync(join(OUT_DIR, `quickbooks-token-${name}.svg`), tokenLifecycle(theme));
}
console.log("Wrote 4 SVGs to docs/");
