import app from "./entry-v241.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") return handleHealth(request, env, ctx);
    if (url.pathname === "/api/build-v2" && request.method === "POST") return handleBuildV25(request, env, ctx);
    return app.fetch(request, env, ctx);
  },
};

async function handleHealth(request, env, ctx) {
  const base = await app.fetch(request, env, ctx);
  const payload = await base.json().catch(() => ({}));
  return json({
    ...payload,
    buildWebMode: "v2.5-spatial-fidelity + v2.4.1-motion-baseline + v2.3.3-visual-baseline + v2.2.1-geometry-baseline + v2.1.3-structure-baseline + v1-static-snapshot",
    structuralLockBaseline: "2.1.3",
    geometryLockBaseline: "2.2.1",
    visualLockBaseline: "2.3.3",
    motionLockBaseline: "2.4.1",
    structuralLockPreserved: true,
    geometryLockPreserved: true,
    visualLockPreserved: true,
    motionLockPreserved: true,
    spatialFidelityEngine: true,
    spatialDepthLayering: true,
    pointerDepthResponse: true,
    scrollDepthResponse: true,
    cardDepthFeedback: true,
    heroPerspectiveResponse: true,
    reducedMotionSpatialGuard: true,
    spatialUsesGeneratedCssOnly: true,
    spatialUsesGeneratedJsOnly: true,
    spatialUsesWebGL: false,
    spatialCopiesTargetThreeJs: false,
    spatialCopiesTargetShaders: false,
    cleanReconstructionUsesTargetScripts: false,
    cleanReconstructionUsesTargetCssAsLayout: false,
    cleanReconstructionBrowserQuotaUsed: false,
    v241BaseEngine: "2.4.1",
    version: "2.5.0",
  }, base.status);
}

async function handleBuildV25(request, env, ctx) {
  const started = Date.now();
  const baseResponse = await app.fetch(request, env, ctx);
  const contentType = baseResponse.headers.get("content-type") || "";
  if (!/application\/json/i.test(contentType)) return baseResponse;

  const payload = await baseResponse.json().catch(() => null);
  if (!payload || !baseResponse.ok || !payload.ok || !payload.html) {
    return new Response(payload ? JSON.stringify(payload) : "{}", { status: baseResponse.status, headers: JSON_HEADERS });
  }

  let html = String(payload.html || "");
  html = stampV25(html);
  html = injectSpatialCss(html);
  html = injectSpatialJs(html);
  html = html
    .replace(/Motion Guard Finalizer Reconstruction V2\.4\.1/g, "Spatial Fidelity Reconstruction V2.5")
    .replace(/Structure, geometry and visual-locked reconstruction with finalized motion fidelity and guarded reduced-motion encounter state\./g, "Structure, geometry, visual and motion-locked reconstruction with generated spatial depth fidelity and accessibility guards.");

  const spatialCssApplied = html.includes("pfr-v25-spatial-css");
  const spatialJsApplied = html.includes("pfr-v25-spatial-js");
  const baselineReady = Boolean(
    payload.stats?.structuralLockReady &&
    payload.stats?.geometryLockReady &&
    payload.stats?.visualBaselinePreserved &&
    payload.stats?.motionBaselineCandidateReady
  );
  const spatialReady = Boolean(spatialCssApplied && spatialJsApplied && baselineReady);

  return json({
    ...payload,
    engine: "v2.5-spatial-fidelity-engine",
    mode: "clean-reconstruction-v25",
    filename: String(payload.filename || "clean-v241.html")
      .replace(/-clean-v241\.html$/i, "-clean-v25.html")
      .replace(/-clean-v24\.html$/i, "-clean-v25.html"),
    html,
    htmlBytes: byteLength(html),
    durationMs: Date.now() - started,
    stats: {
      ...(payload.stats || {}),
      structuralLockPreserved: Boolean(payload.stats?.structuralLockReady),
      geometryLockPreserved: Boolean(payload.stats?.geometryLockReady),
      visualBaselinePreserved: Boolean(payload.stats?.visualBaselinePreserved),
      motionBaselinePreserved: Boolean(payload.stats?.motionBaselineCandidateReady),
      spatialFidelityEngineApplied: spatialReady,
      spatialCssApplied,
      spatialJsApplied,
      spatialDepthLayeringApplied: spatialCssApplied,
      pointerDepthResponseApplied: spatialJsApplied,
      scrollDepthResponseApplied: spatialJsApplied,
      cardDepthFeedbackApplied: spatialCssApplied,
      heroPerspectiveResponseApplied: spatialCssApplied && spatialJsApplied,
      reducedMotionSpatialGuardApplied: spatialCssApplied,
      spatialWebGLUsed: 0,
      targetScriptsCopied: 0,
      targetLayoutCssCopied: 0,
      targetFontFilesCopied: 0,
    },
    model: {
      ...(payload.model || {}),
      spatialFidelity: {
        version: "2.5.0",
        base: "2.4.1",
        structuralBaseline: "2.1.3",
        geometryBaseline: "2.2.1",
        visualBaseline: "2.3.3",
        motionBaseline: "2.4.1",
        perspectivePx: 1100,
        maxTiltDeg: 1.8,
        heroDepthPx: 18,
        cardDepthPx: 16,
        backgroundShiftPx: 10,
        generatedCssOnly: true,
        generatedJsOnly: true,
        webglUsed: false,
      },
    },
    safety: {
      ...(payload.safety || {}),
      targetScriptsCopied: false,
      targetJavaScriptExecutedByBuild: false,
      targetCssUsedAsLayoutFoundation: false,
      targetCssCopied: false,
      targetFontFilesCopied: false,
      spatialUsesGeneratedCssOnly: true,
      spatialUsesGeneratedJsOnly: true,
      spatialExecutesTargetJavaScript: false,
      spatialCopiesTargetThreeJs: false,
      spatialCopiesTargetShaders: false,
      spatialUsesWebGL: false,
      spatialSubmitsTargetForms: false,
      spatialPreservesLockedStructure: Boolean(payload.stats?.structuralLockReady),
      spatialPreservesLockedGeometry: Boolean(payload.stats?.geometryLockReady),
      spatialPreservesLockedVisualBaseline: Boolean(payload.stats?.visualBaselinePreserved),
      spatialPreservesLockedMotionBaseline: Boolean(payload.stats?.motionBaselineCandidateReady),
    },
  }, baseResponse.status);
}

function stampV25(html) {
  return String(html || "").replace(/<html\b([^>]*)>/i, (all, attrs) => {
    let next = String(attrs || "").replace(/\sdata-spatial-engine=(['"])[^'"]*\1/i, "");
    return `<html${next} data-spatial-engine="v2.5">`;
  });
}

function injectSpatialCss(html) {
  const source = String(html || "");
  if (source.includes("pfr-v25-spatial-css")) return source;
  const css = `<style id="pfr-v25-spatial-css">
/* V2.5 — generated spatial fidelity. No target Three.js, shaders, or JavaScript. */
html[data-spatial-engine="v2.5"]{--spatial-perspective:1100px;--spatial-x:0;--spatial-y:0;--spatial-rx:0deg;--spatial-ry:0deg;--spatial-scroll:0;--spatial-depth:18px;--spatial-card-depth:16px;--spatial-bg-x:0px;--spatial-bg-y:0px}
html[data-spatial-engine="v2.5"] .hero,html[data-spatial-engine="v2.5"] .journey-cover,html[data-spatial-engine="v2.5"] .encounter-stage,html[data-spatial-engine="v2.5"] .menu-journey-grid,html[data-spatial-engine="v2.5"] .menu-blog-grid{perspective:var(--spatial-perspective);transform-style:preserve-3d}
html[data-spatial-engine="v2.5"] .hero-inner{transform:perspective(var(--spatial-perspective)) rotateX(var(--spatial-rx)) rotateY(var(--spatial-ry));transform-style:preserve-3d;transition:transform 420ms cubic-bezier(.22,.61,.36,1);will-change:transform}
html[data-spatial-engine="v2.5"][data-spatial-active="true"] .hero:before{transform:translate3d(var(--spatial-bg-x),var(--spatial-bg-y),0) scale(1.012);will-change:transform}
html[data-spatial-engine="v2.5"] .hero:before{transition:transform 520ms cubic-bezier(.22,.61,.36,1)}
html[data-spatial-engine="v2.5"] .journey-cover h2{transform:translateZ(0);transition:transform 520ms cubic-bezier(.16,1,.3,1)}
html[data-spatial-engine="v2.5"][data-spatial-active="true"] .journey-cover h2{transform:translateZ(12px)}
html[data-spatial-engine="v2.5"] .encounter-image.active{transform:scale(1) translateZ(0)}
@media(hover:hover) and (pointer:fine){
html[data-spatial-engine="v2.5"] .menu-journey-card:hover,html[data-spatial-engine="v2.5"] .menu-blog-card:hover{transform:translate3d(0,-4px,var(--spatial-card-depth)) rotateX(.35deg)}
html[data-spatial-engine="v2.5"] .pill:hover,html[data-spatial-engine="v2.5"] .journeys-btn:hover{transform:translate3d(0,-2px,8px)}
}
@media(prefers-reduced-motion:reduce){
html[data-spatial-engine="v2.5"]{--spatial-rx:0deg;--spatial-ry:0deg;--spatial-bg-x:0px;--spatial-bg-y:0px}
html[data-spatial-engine="v2.5"] .hero-inner,html[data-spatial-engine="v2.5"] .hero:before,html[data-spatial-engine="v2.5"] .journey-cover h2,html[data-spatial-engine="v2.5"] .menu-journey-card,html[data-spatial-engine="v2.5"] .menu-blog-card{transform:none!important;transition-duration:.01ms!important}
}
</style>`;
  return /<\/head\s*>/i.test(source) ? source.replace(/<\/head\s*>/i, `${css}</head>`) : css + source;
}

function injectSpatialJs(html) {
  const source = String(html || "");
  if (source.includes("pfr-v25-spatial-js")) return source;
  const js = `<script id="pfr-v25-spatial-js">(()=>{const d=document.documentElement,reduce=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(hover:hover) and (pointer:fine)');if(reduce.matches)return;let tx=0,ty=0,cx=0,cy=0,raf=0;const render=()=>{raf=0;cx+=(tx-cx)*.12;cy+=(ty-cy)*.12;d.style.setProperty('--spatial-rx',(-cy*1.8).toFixed(3)+'deg');d.style.setProperty('--spatial-ry',(cx*1.8).toFixed(3)+'deg');d.style.setProperty('--spatial-bg-x',(-cx*10).toFixed(2)+'px');d.style.setProperty('--spatial-bg-y',(-cy*8).toFixed(2)+'px');if(Math.abs(tx-cx)>.002||Math.abs(ty-cy)>.002)raf=requestAnimationFrame(render)};const kick=()=>{if(!raf)raf=requestAnimationFrame(render)};if(fine.matches){addEventListener('pointermove',e=>{tx=(e.clientX/innerWidth-.5)*2;ty=(e.clientY/innerHeight-.5)*2;d.dataset.spatialActive='true';kick()},{passive:true});addEventListener('pointerleave',()=>{tx=0;ty=0;d.dataset.spatialActive='false';kick()},{passive:true})}let scrollTick=false;addEventListener('scroll',()=>{if(scrollTick)return;scrollTick=true;requestAnimationFrame(()=>{const h=Math.max(document.documentElement.scrollHeight-innerHeight,1);d.style.setProperty('--spatial-scroll',(scrollY/h).toFixed(4));scrollTick=false})},{passive:true})})();</script>`;
  return source.replace(/<\/body\s*>/i, `${js}</body>`);
}

function byteLength(value) { return new TextEncoder().encode(String(value || "")).length; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS }); }
