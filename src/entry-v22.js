import app from "./entry-v213.js";

const MAX_SOURCE_BYTES = 2_500_000;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "Passive Fetch / Render Auditor",
        browserRunConfigured: Boolean(env.BROWSER),
        accessKeyConfigured: Boolean(env.AUDIT_KEY),
        buildWebConfigured: true,
        buildWebV1Configured: true,
        buildWebV2Configured: true,
        buildWebMode: "v2.2-layout-aware-geometry + v2.1.3-structure-lock + v2.1.2-boundary-typography + v2.1.1-structural-fidelity + v2.1-block-aware + v2.0-legacy + v1-static-snapshot",
        cleanReconstructionEngine: true,
        blockAwareReconstruction: true,
        structuralLockBaseline: "2.1.3",
        structuralLockPreserved: true,
        layoutAwareGeometry: true,
        geometryEngine: true,
        geometryProfileRecovery: true,
        geometryUsesPublicCssTokensOnly: true,
        geometryCopiesTargetCss: false,
        cleanReconstructionUsesTargetScripts: false,
        cleanReconstructionUsesTargetCssAsLayout: false,
        cleanReconstructionBrowserQuotaUsed: false,
        fontFilesCopied: false,
        v213BaseEngine: "2.1.3",
        v1CompatibilityEngine: "1.6.3",
        version: "2.2.0",
      });
    }

    if (url.pathname === "/api/build-v2" && request.method === "POST") {
      return handleBuildV22(request, env, ctx);
    }

    return app.fetch(request, env, ctx);
  },
};

async function handleBuildV22(request, env, ctx) {
  const started = Date.now();
  const baseResponse = await app.fetch(request, env, ctx);
  const contentType = baseResponse.headers.get("content-type") || "";
  if (!/application\/json/i.test(contentType)) return baseResponse;

  const payload = await baseResponse.json().catch(() => null);
  if (!payload || !baseResponse.ok || !payload.ok || !payload.html) {
    return new Response(payload ? JSON.stringify(payload) : "{}", {
      status: baseResponse.status,
      headers: JSON_HEADERS,
    });
  }

  let html = String(payload.html || "");
  const source = await refetchPublicHtml(payload.finalUrl || payload.target);
  const geometry = extractGeometryProfile(source || "");

  html = applyGeometryMarkup(html);
  html = injectGeometryCss(html, geometry);
  html = html
    .replace(/Intro Group Reconstruction V2\.1\.3/g, "Layout-Aware Geometry Reconstruction V2.2")
    .replace(/Structure-locked clean reconstruction from public page content\./g, "Structure-locked reconstruction with generated layout-aware geometry from public page signals.");

  const structuralLockReady = Boolean(payload.stats?.structuralLockReady);
  const geometryApplied = html.includes("pfr-v22-geometry-css") && html.includes("data-geometry-engine=\"v2.2\"");
  const geometryTokenCount = Object.values(geometry).filter((value) => value !== null && value !== undefined).length;

  return json({
    ...payload,
    engine: "v2.2-layout-aware-geometry",
    mode: "clean-reconstruction-v22",
    filename: String(payload.filename || "clean-v213.html")
      .replace(/-clean-v213\.html$/i, "-clean-v22.html")
      .replace(/-clean-v212\.html$/i, "-clean-v22.html")
      .replace(/-clean-v211\.html$/i, "-clean-v22.html")
      .replace(/-clean-v21\.html$/i, "-clean-v22.html"),
    html,
    htmlBytes: byteLength(html),
    durationMs: Date.now() - started,
    stats: {
      ...(payload.stats || {}),
      structuralLockReady,
      structuralLockPreserved: structuralLockReady,
      geometrySourceRefetchUsed: Boolean(source),
      layoutAwareGeometry: geometryApplied,
      geometryEngineApplied: geometryApplied,
      geometryTokensRecovered: geometryTokenCount,
      geometryGridColumns: 12,
      geometryGridGapVw: geometry.gridGapVw,
      geometrySideMarginDesktop: geometry.sideDesktop,
      geometrySideMarginMobile: geometry.sideMobile,
      geometryEncounterHeightDesktop: geometry.encounterHeight,
      geometryEncounterHeightMobileVw: geometry.encounterMobileHeightVw,
      geometryMembershipAspect: `${geometry.membershipWidth}/${geometry.membershipHeight}`,
      targetScriptsCopied: 0,
      targetLayoutCssCopied: 0,
    },
    model: {
      ...(payload.model || {}),
      geometryProfile: geometry,
      geometryEngine: {
        version: "2.2.0",
        structuralBaseline: "2.1.3",
        generatedCssOnly: true,
        targetCssCopied: false,
        targetScriptsCopied: false,
      },
    },
    safety: {
      ...(payload.safety || {}),
      targetScriptsCopied: false,
      targetJavaScriptExecutedByBuild: false,
      targetCssUsedAsLayoutFoundation: false,
      targetCssCopied: false,
      geometryReadsNumericPublicCssSignalsOnly: true,
      geometryOutputUsesGeneratedCssOnly: true,
      targetFontFilesCopied: false,
    },
  }, baseResponse.status);
}

async function refetchPublicHtml(value) {
  try {
    const url = new URL(value);
    if (!isSafePublicUrl(url)) return "";
    const response = await fetch(url.href, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "user-agent": "Passive-Fetch-Render-Auditor/2.2 Layout-Aware-Geometry",
        dnt: "1",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok || !/html|xhtml/i.test(response.headers.get("content-type") || "")) return "";
    const text = await response.text();
    return byteLength(text) <= MAX_SOURCE_BYTES ? text : "";
  } catch {
    return "";
  }
}

function extractGeometryProfile(source) {
  const text = String(source || "");
  const membership = membershipDimensions(text);
  return {
    gridColumns: 12,
    gridGapVw: numeric(text, /column-gap:([\d.]+)vw;display:grid;grid-template-columns:repeat\(12,1fr\)/i, 2.2, 0, 10),
    wideSize: numeric(text, /--wp--style--global--wide-size:\s*([\d.]+)px/i, 995, 320, 2200),
    sideDesktop: numeric(text, /--sideMargin:([\d.]+)px/i, 40, 0, 160),
    sideMobile: numeric(text, /@media\s+screen\s+and\s*\(max-width:600px\)\{body\{[^}]*--sideMargin:([\d.]+)px/i, 20, 0, 100),
    smallSpacing: numeric(text, /--smallSpacing:([\d.]+)px/i, 60, 0, 400),
    defaultSpacing: numeric(text, /--defaultSpacing:([\d.]+)px/i, 100, 0, 500),
    largeSpacing: numeric(text, /--largeSpacing:([\d.]+)px/i, 120, 0, 600),
    xlargeSpacing: numeric(text, /--xlargeSpacing:([\d.]+)px/i, 180, 0, 800),
    contentPadding: numeric(text, /--content-padding:([\d.]+)px/i, 30, 0, 160),
    heroMinDesktop: numeric(text, /\.home\s+\.featured-img\{height:100vh;min-height:([\d.]+)px/i, 768, 320, 1600),
    heroMinMobile: numeric(text, /@media\s+screen\s+and\s*\(max-width:600px\)\{\.home\s+\.featured-img\{min-height:([\d.]+)px/i, 667, 320, 1400),
    journeyTitleDesktop: cssLengthPx(first(text, /--wp--preset--font-size--gigantic:\s*([^;}]+)[;}]/i), 110),
    journeyTitleMobile: cssLengthPx(first(text, /@media\s+screen\s+and\s*\(max-width:600px\)\{body\{--wp--preset--font-size--gigantic:([^;}]+)[;}]/i), 58),
    encounterHeight: numeric(text, /\.ue-imgs-wrapper\{grid-column:[^;]+;height:([\d.]+)px/i, 602, 260, 1200),
    encounterMobileHeightVw: numeric(text, /@media\s+screen\s+and\s*\(max-width:992px\)\{\.unforgettable-encounters-block[^{}]*\.ue-imgs-wrapper\{[^}]*height:([\d.]+)vw/i, 72.8, 30, 150),
    encounterBreakpoint: 992,
    encounterRadius: numeric(text, /\.ue-imgs-wrapper\s+\.ue-imgs\{[^}]*border-radius:([\d.]+)px/i, 40, 0, 120),
    encounterRadiusMobile: numeric(text, /@media\s+screen\s+and\s*\(max-width:600px\)\{\.unforgettable-encounters-block[^{}]*\.ue-imgs\{border-radius:([\d.]+)px/i, 30, 0, 100),
    arrowWidth: numeric(text, /\.ue-imgs-wrapper\s+\.arrow\{[^}]*width:([\d.]+)px/i, 53, 20, 120),
    arrowHeight: numeric(text, /\.ue-imgs-wrapper\s+\.arrow\{[^}]*height:([\d.]+)px/i, 50, 20, 120),
    arrowOffset: numeric(text, /\.ue-imgs-wrapper\s+\.arrow\.prev\{left:-([\d.]+)px/i, 26.5, 0, 80),
    arrowOffsetMobile: numeric(text, /@media\s+screen\s+and\s*\(max-width:600px\)\{\.unforgettable-encounters-block[^{}]*\.arrow\.prev\{left:-([\d.]+)px/i, 10, 0, 80),
    membershipWidth: membership.width,
    membershipHeight: membership.height,
  };
}

function membershipDimensions(source) {
  const index = source.indexOf("memberships-slider");
  if (index < 0) return { width: 380, height: 268 };
  const chunk = source.slice(index, index + 18000);
  const img = chunk.match(/<img\b[^>]*\bwidth=["']([\d.]+)["'][^>]*\bheight=["']([\d.]+)["']/i);
  const width = clampNumber(img?.[1], 380, 80, 2000);
  const height = clampNumber(img?.[2], 268, 60, 1600);
  return { width, height };
}

function applyGeometryMarkup(html) {
  let out = String(html || "");
  out = out.replace(/<html\b([^>]*)>/i, (match, attrs) => /data-geometry-engine=/i.test(attrs)
    ? match
    : `<html${attrs} data-geometry-engine="v2.2">`);

  const journey = findSectionByHeading(out, "Journey Through Portugal");
  if (journey) {
    const block = out.slice(journey.start, journey.end);
    const next = addClassToSection(block, "journey-cover");
    out = out.slice(0, journey.start) + next + out.slice(journey.end);
  }

  const callout = findSectionByClass(out, "callout");
  if (callout) {
    let block = out.slice(callout.start, callout.end);
    block = block.replace(/<h2>\s*Ready to explore Portugal\?\s*<\/h2>/i,
      '<div class="ready-lines"><h2>Ready to explore</h2><h2>Portugal?</h2></div>');
    const bg = first(out, /testimonial-section[^>]*style=["'][^"']*--section-bg:url\(['"]?([^'"\)]+)['"]?\)/i);
    if (bg && /^https?:\/\//i.test(bg)) {
      block = block.replace(/<section\b([^>]*)>/i, (match, attrs) => /\bstyle=/i.test(attrs)
        ? match
        : `<section${attrs} style="--section-bg:url('${escAttr(bg)}')">`);
    }
    out = out.slice(0, callout.start) + block + out.slice(callout.end);
  }

  return out;
}

function injectGeometryCss(html, g) {
  if (html.includes("pfr-v22-geometry-css")) return html;
  const css = `<style id="pfr-v22-geometry-css">
:root{--geo-cols:12;--geo-gap:${fmt(g.gridGapVw)}vw;--geo-wide:${fmt(g.wideSize)}px;--geo-side:${fmt(g.sideDesktop)}px;--geo-side-mobile:${fmt(g.sideMobile)}px;--geo-small:${fmt(g.smallSpacing)}px;--geo-default:${fmt(g.defaultSpacing)}px;--geo-large:${fmt(g.largeSpacing)}px;--geo-xlarge:${fmt(g.xlargeSpacing)}px;--geo-content-pad:${fmt(g.contentPadding)}px;--geo-hero-min:${fmt(g.heroMinDesktop)}px;--geo-hero-min-mobile:${fmt(g.heroMinMobile)}px;--geo-journey-title:${fmt(g.journeyTitleDesktop)}px;--geo-journey-title-mobile:${fmt(g.journeyTitleMobile)}px;--geo-encounter-h:${fmt(g.encounterHeight)}px;--geo-encounter-h-mobile:${fmt(g.encounterMobileHeightVw)}vw;--geo-radius:${fmt(g.encounterRadius)}px;--geo-radius-mobile:${fmt(g.encounterRadiusMobile)}px;--geo-arrow-w:${fmt(g.arrowWidth)}px;--geo-arrow-h:${fmt(g.arrowHeight)}px;--geo-arrow-offset:${fmt(g.arrowOffset)}px;--geo-arrow-offset-mobile:${fmt(g.arrowOffsetMobile)}px;--geo-member-w:${fmt(g.membershipWidth)}px;--geo-member-h:${fmt(g.membershipHeight)}px}
body{--side:var(--geo-side)}
.topbar{padding:30px var(--geo-side) 0}.hero{min-height:max(100svh,var(--geo-hero-min))}.hero-inner{width:min(var(--geo-wide),calc(100% - (2 * var(--geo-side))))}.hero h1{max-width:var(--geo-wide);margin-left:auto!important;margin-right:auto!important}
.journey-cover{position:relative;min-height:100svh;padding:0!important;display:grid;place-items:center;overflow:hidden;background:var(--paper);isolation:isolate}.journey-cover .section-inner{position:relative;width:100%!important;max-width:none!important;min-height:100svh;display:grid;place-items:center;overflow:hidden}.journey-cover h2{position:relative;z-index:2;width:min(var(--geo-wide),calc(100% - (2 * var(--geo-side))));margin:0!important;font-size:var(--geo-journey-title)!important;line-height:1.02!important}.journey-cover .copy{display:none}.journey-cover .gallery{position:absolute;inset:0;display:block!important;z-index:0}.journey-cover .gallery figure,.journey-cover .gallery figure:nth-child(4n+1){position:absolute;inset:0;width:100%;height:100%;margin:0;display:block;aspect-ratio:auto;overflow:hidden;border-radius:0!important}.journey-cover .gallery img{width:100%;height:100%;object-fit:cover;border-radius:0!important}.journey-cover .gallery:after{content:"";position:absolute;inset:0;background:rgba(255,255,255,.10);pointer-events:none}
.encounters-intro-group{padding-left:0!important;padding-right:0!important}.encounters-intro-headings{width:min(var(--geo-wide),calc(100% - (2 * var(--geo-side))))!important}.encounters-intro-media{width:calc(100% - (2 * var(--geo-side)))!important;margin-left:auto!important;margin-right:auto!important;border-radius:var(--geo-radius)!important}
.encounters-section{padding-left:var(--geo-side)!important;padding-right:var(--geo-side)!important}.encounters-section .section-inner{width:100%!important;max-width:none!important}.encounters-layout{display:grid!important;grid-template-columns:repeat(12,minmax(0,1fr))!important;column-gap:var(--geo-gap)!important;row-gap:0!important;align-items:start}.encounter-tabs{grid-column:1/4;grid-row:1;display:flex;flex-direction:column}.encounter-stage{grid-column:4/-1;grid-row:1/3;height:var(--geo-encounter-h)!important;min-height:var(--geo-encounter-h)!important;border-radius:var(--geo-radius)!important;overflow:visible!important;background:var(--surface)}.encounter-image{border-radius:var(--geo-radius)!important;clip-path:inset(0 round var(--geo-radius))}.encounter-detail{grid-column:1/4!important;grid-row:2;margin:30px 0 0!important;padding-right:20px}.encounter-arrow{width:var(--geo-arrow-w)!important;height:var(--geo-arrow-h)!important}.encounter-arrow.prev{left:calc(-1 * var(--geo-arrow-offset))!important}.encounter-arrow.next{right:calc(-1 * var(--geo-arrow-offset))!important}
.testimonial-section{padding:var(--geo-large) var(--geo-side)!important}.testimonial-section .section-inner{width:min(1180px,100%)}.testimonial-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:var(--geo-gap)!important}.callout{position:relative;isolation:isolate;overflow:hidden;padding:var(--geo-large) var(--geo-side) var(--geo-xlarge)!important;color:#fff;background:#93887e}.callout:before{content:"";position:absolute;inset:0;background-image:var(--section-bg);background-size:cover;background-position:center bottom;z-index:-2}.callout:after{content:"";position:absolute;inset:0;background:rgba(89,80,79,.34);z-index:-1}.callout .section-inner{width:min(var(--geo-wide),100%)}.ready-lines{display:grid;justify-items:center}.ready-lines h2{margin:0!important;color:#fff!important;font-size:var(--pfr-h1-desktop,84px)!important;line-height:1.05!important}
.map-section{min-height:100svh!important;padding:var(--geo-large) var(--geo-side)!important}.map-section .map-bg{object-fit:cover!important;object-position:center center!important}.map-card{width:min(640px,calc(100% - 40px))!important;padding:0!important;border-radius:0!important;background:transparent!important;backdrop-filter:none!important}.map-card h2{font-size:var(--pfr-h1-desktop,84px)!important;margin-bottom:30px!important}.map-card .copy{width:min(640px,100%)}
.memberships-section{padding:var(--geo-large) var(--geo-side) var(--geo-large)!important}.memberships-section .section-inner{width:100%!important;max-width:none!important}.memberships-section h2{margin-bottom:var(--geo-small)!important}.memberships-section .partners{gap:20px!important;margin-top:0!important;overflow-x:auto;padding:0 0 14px}.memberships-section .partner{flex:0 0 min(var(--geo-member-w),72vw)!important;aspect-ratio:var(--geo-member-w)/var(--geo-member-h);min-height:0!important;padding:20px 35px!important;border:0!important;border-radius:0!important;background:transparent!important}.memberships-section .partner img{max-height:82%!important;max-width:100%!important}
@media(max-width:1200px){.encounter-tabs{grid-column:1/5}.encounter-stage{grid-column:5/-1}.encounter-detail{grid-column:1/5!important}}
@media(max-width:992px){.encounters-layout{grid-template-columns:1fr!important;row-gap:20px!important}.encounter-tabs{grid-column:1!important;grid-row:auto;order:1;flex-direction:row;overflow:auto;gap:18px;padding-bottom:6px}.encounter-stage{grid-column:1!important;grid-row:auto;order:2;height:var(--geo-encounter-h-mobile)!important;min-height:var(--geo-encounter-h-mobile)!important}.encounter-detail{grid-column:1!important;grid-row:auto;order:3;margin:0!important;padding-right:0}.encounter-arrow.prev{left:calc(-1 * min(var(--geo-arrow-offset),18px))!important}.encounter-arrow.next{right:calc(-1 * min(var(--geo-arrow-offset),18px))!important}.testimonial-grid{grid-template-columns:1fr!important}}
@media(max-width:768px){.topbar{padding-top:20px}.testimonial-section{padding-block:var(--geo-default)!important}.callout{padding-block:var(--geo-default)!important}.map-section{padding-block:var(--geo-default)!important}}
@media(max-width:600px){body{--side:var(--geo-side-mobile)}.hero{min-height:max(100svh,var(--geo-hero-min-mobile))}.hero-inner{width:calc(100% - (2 * var(--geo-side-mobile)))}.journey-cover h2{font-size:var(--geo-journey-title-mobile)!important;width:calc(100% - (2 * var(--geo-side-mobile)))}.encounters-intro-headings{width:calc(100% - (2 * var(--geo-side-mobile)))!important}.encounters-intro-media{width:calc(100% - (2 * var(--geo-side-mobile)))!important;border-radius:var(--geo-radius-mobile)!important}.encounter-stage,.encounter-image{border-radius:var(--geo-radius-mobile)!important}.encounter-image{clip-path:inset(0 round var(--geo-radius-mobile))}.encounter-arrow.prev{left:calc(-1 * var(--geo-arrow-offset-mobile))!important}.encounter-arrow.next{right:calc(-1 * var(--geo-arrow-offset-mobile))!important}.ready-lines h2,.map-card h2{font-size:var(--pfr-h1-mobile,3.625rem)!important}.memberships-section .partner{flex-basis:min(var(--geo-member-w),82vw)!important}}
</style>`;
  return html.replace(/<\/head>/i, `${css}</head>`);
}

function findSectionByHeading(html, heading) {
  const re = /<section\b[^>]*>[\s\S]*?<\/section>/gi;
  let match;
  while ((match = re.exec(html))) {
    const h2 = match[0].match(/<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/i);
    if (h2 && cleanText(h2[1]) === heading) return { start: match.index, end: re.lastIndex };
  }
  return null;
}

function findSectionByClass(html, className) {
  const re = /<section\b([^>]*)>[\s\S]*?<\/section>/gi;
  let match;
  while ((match = re.exec(html))) {
    const classes = attr(match[1], "class").split(/\s+/);
    if (classes.includes(className)) return { start: match.index, end: re.lastIndex };
  }
  return null;
}

function addClassToSection(block, className) {
  return String(block || "").replace(/<section\b([^>]*)>/i, (match, attrs) => {
    const classMatch = attrs.match(/\bclass=(["'])([\s\S]*?)\1/i);
    if (!classMatch) return `<section${attrs} class="${className}">`;
    const classes = classMatch[2].split(/\s+/).filter(Boolean);
    if (!classes.includes(className)) classes.push(className);
    return match.replace(classMatch[0], `class=${classMatch[1]}${classes.join(" ")}${classMatch[1]}`);
  });
}

function attr(attrs, name) {
  return String(attrs || "").match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2]
    || String(attrs || "").match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i"))?.[1]
    || "";
}

function first(text, re) { return String(text || "").match(re)?.[1] || ""; }
function cleanText(value) { return String(value || "").replace(/<[^>]+>/g, " ").replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim(); }
function numeric(text, re, fallback, min, max) { return clampNumber(first(text, re), fallback, min, max); }
function clampNumber(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}
function cssLengthPx(value, fallback) {
  const text = String(value || "").trim();
  let m = text.match(/^([\d.]+)px$/i); if (m) return clampNumber(m[1], fallback, 8, 400);
  m = text.match(/^([\d.]+)rem$/i); if (m) return clampNumber(Number(m[1]) * 16, fallback, 8, 400);
  return fallback;
}
function fmt(value) { return Number(value).toFixed(3).replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, ""); }
function escAttr(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#039;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function isSafePublicUrl(url) {
  if (!(url instanceof URL) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return false;
  if (host === "::1" || host === "::" || /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return false;
  return true;
}
function byteLength(value) { return new TextEncoder().encode(String(value || "")).length; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS }); }
