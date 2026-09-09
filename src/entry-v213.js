import app from "./entry-v212.js";

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
        buildWebMode: "v2.1.3-intro-group-recovery + v2.1.2-boundary-typography + v2.1.1-structural-fidelity + v2.1-block-aware + v2.0-legacy + v1-static-snapshot",
        cleanReconstructionEngine: true,
        blockAwareReconstruction: true,
        structuralFidelityPass: true,
        boundaryTypographyPolish: true,
        introGroupRecovery: true,
        introImageRecovery: true,
        structuralLockValidationV2: true,
        exactMembershipBoundaryRecovery: true,
        typographyFallbackCalibration: true,
        fontFilesCopied: false,
        fontAvailabilityAsserted: false,
        cleanReconstructionUsesTargetScripts: false,
        cleanReconstructionUsesTargetCssAsLayout: false,
        cleanReconstructionBrowserQuotaUsed: false,
        introSourceRefetch: true,
        v212BaseEngine: "2.1.2",
        v211BaseEngine: "2.1.1",
        v21BaseEngine: "2.1.0",
        v2LegacyEngine: "2.0.2",
        v1CompatibilityEngine: "1.6.3",
        version: "2.1.3",
      });
    }

    if (url.pathname === "/api/build-v2" && request.method === "POST") {
      return handleBuildV213(request, env, ctx);
    }

    return app.fetch(request, env, ctx);
  },
};

async function handleBuildV213(request, env, ctx) {
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
  const intro = source ? extractIntroGroup(source, payload.finalUrl || payload.target) : null;
  let introApplied = false;

  if (intro && intro.headings.length === 4 && intro.image) {
    const next = recoverIntroGroup(html, intro);
    if (next !== html) {
      html = injectIntroCss(next);
      introApplied = true;
    }
  }

  html = html
    .replace(/Boundary & Typography Reconstruction V2\.1\.2/g, "Intro Group Reconstruction V2.1.3")
    .replace(/Boundary-safe structural reconstruction from public page content\./g, "Structure-locked clean reconstruction from public page content.");

  const structuralLockReady = Boolean(
    payload.stats?.structuralLockReady &&
    introApplied &&
    intro?.headings?.length === 4 &&
    intro?.image
  );

  return json({
    ...payload,
    engine: "v2.1.3-intro-group-reconstruction",
    mode: "clean-reconstruction-v213",
    filename: String(payload.filename || "clean-v212.html")
      .replace(/-clean-v212\.html$/i, "-clean-v213.html")
      .replace(/-clean-v211\.html$/i, "-clean-v213.html")
      .replace(/-clean-v21\.html$/i, "-clean-v213.html"),
    html,
    htmlBytes: byteLength(html),
    stats: {
      ...(payload.stats || {}),
      introSourceRefetchUsed: Boolean(source),
      introGroupRecovered: introApplied,
      introHeadingCountRecovered: intro?.headings?.length || 0,
      introImageRecovered: Boolean(intro?.image),
      introSpacerSmallRecovered: intro?.spacerSmall || 0,
      introSpacerMediumRecovered: intro?.spacerMedium || 0,
      introSpacerLargeRecovered: intro?.spacerLarge || 0,
      structuralLockReady,
    },
    model: {
      ...(payload.model || {}),
      introGroup: intro ? {
        headings: intro.headings,
        image: intro.image,
        spacerSmall: intro.spacerSmall,
        spacerMedium: intro.spacerMedium,
        spacerLarge: intro.spacerLarge,
      } : null,
      structuralValidation: {
        ...(payload.model?.structuralValidation || {}),
        introGroupRecovered: introApplied,
        introHeadingCount: intro?.headings?.length || 0,
        introImageRecovered: Boolean(intro?.image),
        ready: structuralLockReady,
      },
    },
    safety: {
      ...(payload.safety || {}),
      targetScriptsCopied: false,
      targetJavaScriptExecutedByBuild: false,
      targetCssUsedAsLayoutFoundation: false,
      targetFontFilesCopied: false,
      introRecoveryUsesPublicMarkupOnly: true,
      introRecoveryGeneratedLayoutOnly: true,
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
        "user-agent": "Passive-Fetch-Render-Auditor/2.1.3 Intro-Group",
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

function extractIntroGroup(source, baseHref) {
  const open = /<div\b[^>]*class=["'][^"']*\bunforgettable-encounters-intro\b[^"']*["'][^>]*>/i.exec(source);
  if (!open) return null;
  const chunk = extractBalancedDiv(source, open.index);
  if (!chunk) return null;

  const headings = [];
  const headingRe = /<h2\b[^>]*>([\s\S]*?)<\/h2\s*>/gi;
  let match;
  while ((match = headingRe.exec(chunk)) && headings.length < 8) {
    const value = cleanText(match[1]);
    if (value && !headings.includes(value)) headings.push(value);
  }

  const expected = ["Discover", "Experience", "Indulge in", "Unforgettable Encounters"];
  if (expected.some((value, index) => headings[index] !== value)) return null;

  const img = chunk.match(/<img\b([^>]*)>/i);
  const image = img ? resolvePublicUrl(attr(img[1], "src") || attr(img[1], "data-src"), baseHref) : null;
  const spacer = chunk.match(/<div\b[^>]*class=["'][^"']*\bresponsive-spacer\b[^"']*["'][^>]*>/i)?.[0] || "";

  return {
    headings: expected,
    image,
    spacerSmall: safeNumber(attr(spacer, "data-small"), 192),
    spacerMedium: safeNumber(attr(spacer, "data-medium"), 256),
    spacerLarge: safeNumber(attr(spacer, "data-large"), 256),
  };
}

function recoverIntroGroup(html, intro) {
  let out = String(html || "");
  const ranges = ["Discover", "Experience", "Indulge in"].map((heading) => findSectionByHeading(out, heading));
  if (ranges.some((range) => !range)) return out;

  for (const range of ranges.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, range.start) + out.slice(range.end);
  }

  const encounter = findSectionByClass(out, "encounters-section");
  if (!encounter) return html;

  const introHtml = renderIntroGroup(intro);
  out = out.slice(0, encounter.start) + introHtml + out.slice(encounter.start);

  const afterInsert = findSectionByClass(out, "encounters-section");
  if (!afterInsert) return html;
  const block = out.slice(afterInsert.start, afterInsert.end);
  const cleaned = block.replace(/<h2>\s*Unforgettable Encounters\s*<\/h2>/i, "");
  out = out.slice(0, afterInsert.start) + cleaned + out.slice(afterInsert.end);

  return out;
}

function renderIntroGroup(intro) {
  const headings = intro.headings.map((heading) => `<h2>${esc(heading)}</h2>`).join("");
  return `<section class="section encounters-intro-group reveal" data-intro-group><div class="encounters-intro-spacer" aria-hidden="true"></div><div class="section-inner encounters-intro-headings">${headings}</div><figure class="encounters-intro-media"><img loading="lazy" src="${escAttr(intro.image)}" alt=""></figure></section>`;
}

function injectIntroCss(html) {
  if (html.includes("pfr-v213-intro-css")) return html;
  const css = `<style id="pfr-v213-intro-css">
.encounters-intro-group{padding-top:0;padding-left:var(--side);padding-right:var(--side);padding-bottom:clamp(90px,10vw,150px);overflow:hidden}.encounters-intro-spacer{height:256px}.encounters-intro-headings{display:grid;justify-items:center;gap:0}.encounters-intro-group h2{margin:0;text-align:center;font-family:var(--pfr-serif,var(--serif));font-size:var(--pfr-h1-desktop,84px)!important;line-height:1.05!important;font-weight:400;letter-spacing:0!important}.encounters-intro-media{width:100%;margin:clamp(50px,6vw,90px) 0 0;overflow:hidden;border-radius:var(--radius,40px);aspect-ratio:2048/1092;background:var(--surface)}.encounters-intro-media img{width:100%;height:100%;object-fit:cover;border-radius:0}.encounters-section{padding-top:clamp(80px,8vw,120px)}
@media(max-width:768px){.encounters-intro-spacer{height:192px}.encounters-intro-group{padding-inline:20px}.encounters-intro-media{border-radius:30px}}
@media(max-width:600px){.encounters-intro-group h2{font-size:var(--pfr-h1-mobile,3.625rem)!important}}
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

function extractBalancedDiv(source, startIndex) {
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = startIndex;
  let depth = 0;
  let started = false;
  let match;
  while ((match = re.exec(source))) {
    const token = match[0];
    const closing = /^<\/div/i.test(token);
    const selfClosing = /\/\s*>$/.test(token);
    if (!closing) {
      depth += 1;
      started = true;
      if (selfClosing) depth -= 1;
    } else if (started) {
      depth -= 1;
    }
    if (started && depth === 0) return source.slice(startIndex, re.lastIndex);
  }
  return "";
}

function cleanText(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function attr(attrs, name) {
  return String(attrs || "").match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2]
    || String(attrs || "").match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i"))?.[1]
    || "";
}

function resolvePublicUrl(value, baseHref) {
  if (!value || /^data:|^javascript:/i.test(value)) return null;
  try {
    const url = new URL(value, baseHref);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function isSafePublicUrl(url) {
  if (!(url instanceof URL) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return false;
  if (host === "::1" || host === "::" || /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return false;
  return true;
}

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 2000 ? n : fallback;
}

function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function escAttr(value) { return esc(value); }
function byteLength(value) { return new TextEncoder().encode(String(value || "")).length; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS }); }
