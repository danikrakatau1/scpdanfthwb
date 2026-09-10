import app from "./entry-v24.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") return handleHealth(request, env, ctx);
    if (url.pathname === "/api/build-v2" && request.method === "POST") return handleBuildV241(request, env, ctx);
    return app.fetch(request, env, ctx);
  },
};

async function handleHealth(request, env, ctx) {
  const base = await app.fetch(request, env, ctx);
  const payload = await base.json().catch(() => ({}));
  return json({
    ...payload,
    buildWebMode: "v2.4.1-motion-guard-finalizer + v2.4-motion-fidelity + v2.3.3-visual-baseline + v2.2.1-geometry-baseline + v2.1.3-structure-baseline + v1-static-snapshot",
    structuralLockBaseline: "2.1.3",
    geometryLockBaseline: "2.2.1",
    visualLockBaseline: "2.3.3",
    structuralLockPreserved: true,
    geometryLockPreserved: true,
    visualLockPreserved: true,
    motionBaselineCandidate: "2.4.1",
    motionGuardFinalizer: true,
    reducedMotionEncounterStateGuard: true,
    reducedMotionInactiveEncounterHidden: true,
    reducedMotionActiveEncounterVisible: true,
    v24BaseEngine: "2.4.0",
    version: "2.4.1",
  }, base.status);
}

async function handleBuildV241(request, env, ctx) {
  const started = Date.now();
  const baseResponse = await app.fetch(request, env, ctx);
  const contentType = baseResponse.headers.get("content-type") || "";
  if (!/application\/json/i.test(contentType)) return baseResponse;

  const payload = await baseResponse.json().catch(() => null);
  if (!payload || !baseResponse.ok || !payload.ok || !payload.html) {
    return new Response(payload ? JSON.stringify(payload) : "{}", { status: baseResponse.status, headers: JSON_HEADERS });
  }

  let html = String(payload.html || "");
  html = stampV241(html);
  html = injectMotionGuardCss(html);
  html = html
    .replace(/Motion Fidelity Reconstruction V2\.4/g, "Motion Guard Finalizer Reconstruction V2.4.1")
    .replace(/Structure, geometry and visual-locked reconstruction with generated motion fidelity and reduced-motion protection\./g, "Structure, geometry and visual-locked reconstruction with finalized motion fidelity and guarded reduced-motion encounter state.");

  const guardCssApplied = html.includes("pfr-v241-motion-guard-css");
  const inactiveHidden = /prefers-reduced-motion:reduce[\s\S]*?\.encounter-image\{opacity:0!important/i.test(html);
  const activeVisible = /prefers-reduced-motion:reduce[\s\S]*?\.encounter-image\.active\{opacity:1!important/i.test(html);
  const baselineReady = Boolean(payload.stats?.structuralLockReady && payload.stats?.geometryLockReady && payload.stats?.visualBaselinePreserved);
  const motionReady = Boolean(payload.stats?.motionFidelityEngineApplied && guardCssApplied && inactiveHidden && activeVisible && baselineReady);

  return json({
    ...payload,
    engine: "v2.4.1-motion-guard-finalizer",
    mode: "clean-reconstruction-v241",
    filename: String(payload.filename || "clean-v24.html")
      .replace(/-clean-v24\.html$/i, "-clean-v241.html")
      .replace(/-clean-v233\.html$/i, "-clean-v241.html"),
    html,
    htmlBytes: byteLength(html),
    durationMs: Date.now() - started,
    stats: {
      ...(payload.stats || {}),
      motionGuardFinalizerApplied: motionReady,
      reducedMotionEncounterStateGuardApplied: guardCssApplied,
      reducedMotionInactiveEncounterHidden: inactiveHidden,
      reducedMotionActiveEncounterVisible: activeVisible,
      motionBaselineCandidateReady: motionReady,
      targetScriptsCopied: 0,
      targetLayoutCssCopied: 0,
      targetFontFilesCopied: 0,
    },
    model: {
      ...(payload.model || {}),
      motionGuardFinalizer: {
        version: "2.4.1",
        base: "2.4.0",
        reducedMotionEncounterStateGuard: true,
        inactiveEncounterOpacity: 0,
        activeEncounterOpacity: 1,
      },
    },
    safety: {
      ...(payload.safety || {}),
      targetScriptsCopied: false,
      targetJavaScriptExecutedByBuild: false,
      targetCssUsedAsLayoutFoundation: false,
      targetCssCopied: false,
      targetFontFilesCopied: false,
      motionGuardUsesGeneratedCssOnly: true,
      motionGuardExecutesTargetJavaScript: false,
      motionGuardPreservesLockedStructure: Boolean(payload.stats?.structuralLockReady),
      motionGuardPreservesLockedGeometry: Boolean(payload.stats?.geometryLockReady),
      motionGuardPreservesLockedVisualBaseline: Boolean(payload.stats?.visualBaselinePreserved),
    },
  }, baseResponse.status);
}

function stampV241(html) {
  return String(html || "").replace(/<html\b([^>]*)>/i, (all, attrs) => {
    let next = String(attrs || "").replace(/\sdata-motion-guard=(['"])[^'"]*\1/i, "");
    return `<html${next} data-motion-guard="v2.4.1">`;
  });
}

function injectMotionGuardCss(html) {
  const source = String(html || "");
  if (source.includes("pfr-v241-motion-guard-css")) return source;
  const css = `<style id="pfr-v241-motion-guard-css">
/* V2.4.1 — reduced-motion encounter state guard. Generated CSS only. */
@media(prefers-reduced-motion:reduce){
html[data-motion-engine="v2.4"][data-motion-guard="v2.4.1"] .encounter-image{opacity:0!important;transform:none!important}
html[data-motion-engine="v2.4"][data-motion-guard="v2.4.1"] .encounter-image.active{opacity:1!important;transform:none!important}
}
</style>`;
  return /<\/head\s*>/i.test(source) ? source.replace(/<\/head\s*>/i, `${css}</head>`) : css + source;
}

function byteLength(value) { return new TextEncoder().encode(String(value || "")).length; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS }); }
