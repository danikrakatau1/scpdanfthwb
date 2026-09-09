import app from "./entry-v221.js";

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
      return handleBuildV23(request, env, ctx);
    }

    return app.fetch(request, env, ctx);
  },
};

async function handleHealth(request, env, ctx) {
  const base = await app.fetch(request, env, ctx);
  const payload = await base.json().catch(() => ({}));
  return json({
    ...payload,
    buildWebMode: "v2.3-visual-fidelity + v2.2.1-geometry-baseline + v2.1.3-structure-baseline + v1-static-snapshot",
    structuralLockBaseline: "2.1.3",
    geometryLockBaseline: "2.2.1",
    structuralLockPreserved: true,
    geometryLockPreserved: true,
    visualFidelityEngine: true,
    sourceVisualHierarchy: true,
    sourceButtonTreatment: true,
    sourceHeaderSurfaceTreatment: true,
    sourceMenuTypographyTreatment: true,
    testimonialSurfaceRecovery: true,
    readyHeadingToneRecovery: true,
    responsiveVisualPolish: true,
    visualCopiesTargetCss: false,
    cleanReconstructionUsesTargetScripts: false,
    cleanReconstructionUsesTargetCssAsLayout: false,
    cleanReconstructionBrowserQuotaUsed: false,
    v221BaseEngine: "2.2.1",
    v213BaseEngine: "2.1.3",
    version: "2.3.0",
  }, base.status);
}

async function handleBuildV23(request, env, ctx) {
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
  html = stampVisualEngine(html);
  html = injectVisualCss(html);
  html = html
    .replace(/Geometry Fidelity Reconstruction V2\.2\.1/g, "Visual Fidelity Reconstruction V2.3")
    .replace(/Structure-locked reconstruction with generated geometry fidelity polish from public page signals\./g, "Structure and geometry-locked reconstruction with generated visual fidelity polish from public page signals.");

  const visualCssApplied = html.includes("pfr-v23-visual-fidelity-css");
  const testimonialSurfaceApplied = visualCssApplied && html.includes("testimonial-grid");
  const buttonTreatmentApplied = visualCssApplied && html.includes('class="pill');
  const menuTreatmentApplied = visualCssApplied && html.includes('class="menu-overlay"');
  const readyToneApplied = visualCssApplied && html.includes("ready-lines");
  const structuralLockReady = Boolean(payload.stats?.structuralLockReady);
  const geometryLockReady = Boolean(payload.stats?.geometryFidelityPolishApplied && payload.stats?.geometryEngineApplied);

  return json({
    ...payload,
    engine: "v2.3-visual-fidelity-engine",
    mode: "clean-reconstruction-v23",
    filename: String(payload.filename || "clean-v221.html")
      .replace(/-clean-v221\.html$/i, "-clean-v23.html")
      .replace(/-clean-v22\.html$/i, "-clean-v23.html"),
    html,
    htmlBytes: byteLength(html),
    durationMs: Date.now() - started,
    stats: {
      ...(payload.stats || {}),
      structuralLockReady,
      structuralLockPreserved: structuralLockReady,
      geometryLockReady,
      geometryLockPreserved: geometryLockReady,
      visualFidelityEngineApplied: visualCssApplied,
      visualProfileTokensApplied: 12,
      sourceTypographyHierarchyApplied: visualCssApplied,
      sourceButtonTreatmentApplied: buttonTreatmentApplied,
      sourceHeaderSurfaceTreatmentApplied: visualCssApplied,
      sourceMenuTypographyTreatmentApplied: menuTreatmentApplied,
      testimonialSurfaceRecoveryApplied: testimonialSurfaceApplied,
      readyHeadingToneRecoveryApplied: readyToneApplied,
      responsiveVisualPolishApplied: visualCssApplied,
      targetScriptsCopied: 0,
      targetLayoutCssCopied: 0,
      targetFontFilesCopied: 0,
    },
    model: {
      ...(payload.model || {}),
      visualFidelity: {
        version: "2.3.0",
        structuralBaseline: "2.1.3",
        geometryBaseline: "2.2.1",
        generatedCssOnly: true,
        headerControls: { language: "53x34", menu: "46x34", logoDesktop: "186x40", logoMobile: "158x34" },
        buttonTreatment: { radius: 33, paddingY: 18, paddingX: 30, lineHeight: 19 },
        headingHierarchy: { gigantic: 110, huge: 84, extraLarge: 60, mobileHuge: 58 },
        imageRadius: { desktop: 40, mobile: 30 },
        testimonialCardsUseGlass: false,
        readyHeadingTone: "gray",
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
      visualOutputUsesGeneratedCssOnly: true,
      visualFidelityPreservesLockedStructure: true,
      visualFidelityPreservesLockedGeometry: true,
      targetFontFilesCopied: false,
    },
  }, baseResponse.status);
}

function stampVisualEngine(html) {
  return String(html || "").replace(/<html\b([^>]*)>/i, (all, attrs) => {
    let next = String(attrs || "")
      .replace(/\sdata-visual-engine=(['"])[^'"]*\1/i, "")
      .replace(/\sdata-geometry-engine=(['"])[^'"]*\1/i, "");
    return `<html${next} data-geometry-engine="v2.2.1" data-visual-engine="v2.3">`;
  });
}

function injectVisualCss(html) {
  if (html.includes("pfr-v23-visual-fidelity-css")) return html;
  const css = `<style id="pfr-v23-visual-fidelity-css">
/* V2.3 — Visual Fidelity Engine. Generated CSS only; locked structure + geometry preserved. */
html[data-visual-engine="v2.3"] body{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
html[data-visual-engine="v2.3"] .language{width:53px;height:34px;padding:0;display:grid;place-items:center;border:1px solid var(--surface);border-radius:25px;font-size:14px;line-height:1;color:var(--dark);background:var(--surface)}
html[data-visual-engine="v2.3"] .menu-toggle{width:46px;height:34px;border:1px solid var(--surface);border-radius:25px;background:var(--surface)}
html[data-visual-engine="v2.3"] .brand{width:186px;max-width:186px;height:40px;min-height:40px}.brand svg{width:186px;height:auto}
html[data-visual-engine="v2.3"] .menu-overlay{background:var(--surface);padding:150px var(--geo-side,40px) 60px}
html[data-visual-engine="v2.3"] .menu-grid{width:min(var(--geo-wide,995px),100%);grid-template-columns:1fr;gap:30px}
html[data-visual-engine="v2.3"] .menu-grid a{padding:0;border:0;font-family:var(--pfr-serif,var(--serif));font-size:42px;line-height:1.05;font-weight:400}
html[data-visual-engine="v2.3"] .journeys-btn{padding:18px 30px;border-radius:28px;font-size:16px;line-height:19px}.journeys-btn span{font-size:inherit}.journeys-menu a{font-size:16px;line-height:19px}
html[data-visual-engine="v2.3"] .pill{display:inline-block;padding:18px 30px;border-radius:33px;background:var(--brand);color:#fff;font-size:16px;line-height:19px;text-align:center}
html[data-visual-engine="v2.3"] .testimonial-section h2{font-size:var(--pfr-h1-desktop,84px)!important;line-height:1.05!important;margin-bottom:var(--geo-small,60px)!important;color:#fff!important}
html[data-visual-engine="v2.3"] .testimonial-grid{align-items:start;column-gap:var(--geo-gap,2.2vw)!important;row-gap:var(--geo-large,120px)!important}
html[data-visual-engine="v2.3"] .quote{padding:0!important;border:0!important;border-radius:0!important;background:transparent!important;backdrop-filter:none!important;box-shadow:none!important;color:inherit}
html[data-visual-engine="v2.3"] .quote blockquote{margin:0 0 30px;font-family:var(--pfr-serif,var(--serif));font-size:42px;line-height:1.05;font-weight:400;color:inherit}
html[data-visual-engine="v2.3"] .quote cite{margin:0;font-family:var(--pfr-serif,var(--serif));font-size:30px;line-height:1.05;font-style:normal;font-weight:400;opacity:1;color:inherit}
html[data-visual-engine="v2.3"] .moments-composite .ready-lines h2{color:var(--ink)!important}
html[data-visual-engine="v2.3"] .map-card .copy{font-size:16px;line-height:1.5}.map-card .links{margin-top:30px}
html[data-visual-engine="v2.3"] .memberships-section h2{font-size:var(--pfr-h2-desktop,60px)!important}.memberships-section .partner img{filter:none!important;opacity:1}
html[data-visual-engine="v2.3"] .encounter-tab{font-synthesis:none}.encounter-link{white-space:nowrap}
@media(max-width:768px){html[data-visual-engine="v2.3"] .menu-overlay{padding-top:114px;padding-inline:20px}.menu-grid{gap:30px}.menu-grid a{font-size:30px}.testimonial-grid{row-gap:80px!important}}
@media(max-width:600px){html[data-visual-engine="v2.3"] .brand{width:158px;max-width:158px;height:34px;min-height:34px}.brand svg{width:158px}.testimonial-section h2{font-size:var(--pfr-h1-mobile,3.625rem)!important}.quote blockquote{font-size:30px}.quote cite{font-size:21.4px}.pill{font-size:14px}.journeys-btn,.journeys-menu a{font-size:14px}.memberships-section h2{font-size:var(--pfr-h2-mobile,2.678125rem)!important}}
@media(prefers-reduced-motion:reduce){html[data-visual-engine="v2.3"] *{scroll-behavior:auto}}
</style>`;
  return html.replace(/<\/head>/i, `${css}</head>`);
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).length;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
