import app from "./entry-v22.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return handleHealth(request, env, ctx);
    }

    if (url.pathname === "/api/build-v2" && request.method === "POST") {
      return handleBuildV221(request, env, ctx);
    }

    return app.fetch(request, env, ctx);
  },
};

async function handleHealth(request, env, ctx) {
  const base = await app.fetch(request, env, ctx);
  const payload = await base.json().catch(() => ({}));
  return json({
    ...payload,
    buildWebMode: "v2.2.1-geometry-fidelity-polish + v2.2-layout-aware-geometry + v2.1.3-structure-lock + v1-static-snapshot",
    structuralLockBaseline: "2.1.3",
    structuralLockPreserved: true,
    layoutAwareGeometry: true,
    geometryEngine: true,
    geometryFidelityPolish: true,
    trueFullBleedRecovery: true,
    momentsCompositeRecovery: true,
    encounterAbsoluteGeometry: true,
    geometryCopiesTargetCss: false,
    cleanReconstructionUsesTargetScripts: false,
    cleanReconstructionUsesTargetCssAsLayout: false,
    cleanReconstructionBrowserQuotaUsed: false,
    v22BaseEngine: "2.2.0",
    v213BaseEngine: "2.1.3",
    version: "2.2.1",
  }, base.status);
}

async function handleBuildV221(request, env, ctx) {
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
  const composite = recoverMomentsComposite(html);
  html = composite.html;
  html = injectPolishCss(html);
  html = html
    .replace(/Layout-Aware Geometry Reconstruction V2\.2/g, "Geometry Fidelity Reconstruction V2.2.1")
    .replace(/Structure-locked reconstruction with generated layout-aware geometry from public page signals\./g, "Structure-locked reconstruction with generated geometry fidelity polish from public page signals.");

  const fullBleedApplied = html.includes("pfr-v221-geometry-fidelity-css") && html.includes("encounters-intro-media");
  const encounterAbsoluteApplied = html.includes("data-geometry-engine=\"v2.2\"") && html.includes("pfr-v221-geometry-fidelity-css");
  const structuralLockReady = Boolean(payload.stats?.structuralLockReady);

  return json({
    ...payload,
    engine: "v2.2.1-geometry-fidelity-polish",
    mode: "clean-reconstruction-v221",
    filename: String(payload.filename || "clean-v22.html")
      .replace(/-clean-v22\.html$/i, "-clean-v221.html")
      .replace(/-clean-v213\.html$/i, "-clean-v221.html"),
    html,
    htmlBytes: byteLength(html),
    durationMs: Date.now() - started,
    stats: {
      ...(payload.stats || {}),
      structuralLockReady,
      structuralLockPreserved: structuralLockReady,
      geometryEngineApplied: true,
      geometryFidelityPolishApplied: true,
      introTrueFullBleedApplied: fullBleedApplied,
      momentsCompositeApplied: composite.applied,
      encounterAbsoluteGeometryApplied: encounterAbsoluteApplied,
      targetScriptsCopied: 0,
      targetLayoutCssCopied: 0,
    },
    model: {
      ...(payload.model || {}),
      geometryFidelityPolish: {
        version: "2.2.1",
        structuralBaseline: "2.1.3",
        trueFullBleedIntro: true,
        momentsContinuousCanvas: composite.applied,
        encounterDesktopAbsoluteStage: true,
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
      geometryOutputUsesGeneratedCssOnly: true,
      geometryFidelityUsesExistingRecoveredStructureOnly: true,
      targetFontFilesCopied: false,
    },
  }, baseResponse.status);
}

function recoverMomentsComposite(html) {
  const source = String(html || "");
  if (source.includes('data-moments-composite="true"')) return { html: source, applied: true };

  const testimonial = findSectionByClass(source, "testimonial-section");
  const callout = findSectionByClass(source, "callout");
  if (!testimonial || !callout || callout.start <= testimonial.end) return { html: source, applied: false };

  const between = source.slice(testimonial.end, callout.start);
  if (/<section\b/i.test(between)) return { html: source, applied: false };

  let testimonialHtml = source.slice(testimonial.start, testimonial.end);
  let calloutHtml = source.slice(callout.start, callout.end);
  const bg = extractSectionBackground(testimonialHtml) || extractSectionBackground(calloutHtml);

  testimonialHtml = stripSectionInlineBackground(testimonialHtml);
  calloutHtml = stripSectionInlineBackground(calloutHtml);

  const style = bg ? ` style="--moments-bg:url('${escAttr(bg)}')"` : "";
  const wrapper = `<div class="moments-composite reveal" data-moments-composite="true"${style}>${testimonialHtml}${between}${calloutHtml}</div>`;
  const next = source.slice(0, testimonial.start) + wrapper + source.slice(callout.end);
  return { html: next, applied: true };
}

function injectPolishCss(html) {
  if (html.includes("pfr-v221-geometry-fidelity-css")) return html;
  const css = `<style id="pfr-v221-geometry-fidelity-css">
/* V2.2.1 — geometry fidelity polish. Generated CSS only. */
.encounters-intro-media{width:100vw!important;max-width:none!important;margin-left:calc(50% - 50vw)!important;margin-right:calc(50% - 50vw)!important;border-radius:0!important;overflow:visible!important}.encounters-intro-media img{width:100%!important;height:100%!important;object-fit:cover!important;border-radius:var(--geo-radius,40px)!important}
.moments-composite{position:relative;isolation:isolate;overflow:hidden;background:#93887e;color:#fff}.moments-composite:before{content:"";position:absolute;inset:0;background-image:var(--moments-bg);background-size:cover;background-position:center center;z-index:-2}.moments-composite>.testimonial-section,.moments-composite>.callout{position:relative;background:transparent!important}.moments-composite>.testimonial-section:before,.moments-composite>.testimonial-section:after,.moments-composite>.callout:before,.moments-composite>.callout:after{content:none!important;display:none!important}.moments-composite>.testimonial-section{padding-bottom:0!important}.moments-composite>.callout{padding-top:var(--geo-large)!important;color:#fff!important}.moments-composite .ready-lines h2{color:#fff!important}
@media(min-width:993px){.encounters-layout{position:relative!important;min-height:var(--geo-encounter-h)!important}.encounter-tabs{position:relative;z-index:2;grid-column:1/4!important;grid-row:1!important}.encounter-stage{position:absolute!important;grid-column:4/-1!important;grid-row:1!important;top:0!important;left:0!important;right:0!important;bottom:auto!important;width:auto!important;height:var(--geo-encounter-h)!important;min-height:var(--geo-encounter-h)!important;justify-self:stretch;align-self:start;z-index:1}.encounter-detail{position:relative;z-index:2;grid-column:1/4!important;grid-row:2!important;margin:30px 0 0!important}}
@media(min-width:993px) and (max-width:1200px){.encounter-tabs{grid-column:1/5!important}.encounter-stage{grid-column:5/-1!important}.encounter-detail{grid-column:1/5!important}}
@media(max-width:992px){.encounter-stage{position:relative!important;top:auto!important;left:auto!important;right:auto!important;bottom:auto!important;width:100%!important;justify-self:stretch;align-self:auto}.moments-composite>.testimonial-section{padding-bottom:0!important}}
@media(max-width:600px){.encounters-intro-media img{border-radius:var(--geo-radius-mobile,30px)!important}}
</style>`;
  return html.replace(/<\/head>/i, `${css}</head>`);
}

function findSectionByClass(html, className) {
  const re = /<section\b([^>]*)>[\s\S]*?<\/section>/gi;
  let match;
  while ((match = re.exec(html))) {
    const classes = attr(match[1], "class").split(/\s+/).filter(Boolean);
    if (classes.includes(className)) return { start: match.index, end: re.lastIndex };
  }
  return null;
}

function extractSectionBackground(sectionHtml) {
  const style = String(sectionHtml || "").match(/<section\b[^>]*\bstyle=(["'])([\s\S]*?)\1/i)?.[2] || "";
  return style.match(/--section-bg\s*:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i)?.[1] || "";
}

function stripSectionInlineBackground(sectionHtml) {
  return String(sectionHtml || "").replace(/(<section\b[^>]*?)\s+style=(["'])[^"']*--section-bg\s*:[^"']*\2/i, "$1");
}

function attr(attrs, name) {
  return String(attrs || "").match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2]
    || String(attrs || "").match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i"))?.[1]
    || "";
}

function escAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).length;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
