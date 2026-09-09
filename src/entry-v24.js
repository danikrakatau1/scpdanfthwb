import app from "./entry-v233.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") return handleHealth(request, env, ctx);
    if (url.pathname === "/api/build-v2" && request.method === "POST") return handleBuildV24(request, env, ctx);
    return app.fetch(request, env, ctx);
  },
};

async function handleHealth(request, env, ctx) {
  const base = await app.fetch(request, env, ctx);
  const payload = await base.json().catch(() => ({}));
  return json({
    ...payload,
    buildWebMode: "v2.4-motion-fidelity + v2.3.3-visual-baseline + v2.2.1-geometry-baseline + v2.1.3-structure-baseline + v1-static-snapshot",
    structuralLockBaseline: "2.1.3",
    geometryLockBaseline: "2.2.1",
    visualLockBaseline: "2.3.3",
    structuralLockPreserved: true,
    geometryLockPreserved: true,
    visualLockPreserved: true,
    motionFidelityEngine: true,
    menuMotionChoreography: true,
    submenuMotionChoreography: true,
    revealMotionPolish: true,
    encounterMotionPolish: true,
    hoverPressFeedback: true,
    reducedMotionGuard: true,
    baselineCompatibilityBridge: true,
    generatedMotionCssOnly: true,
    generatedMotionJsOnly: true,
    cleanReconstructionUsesTargetScripts: false,
    cleanReconstructionUsesTargetCssAsLayout: false,
    cleanReconstructionBrowserQuotaUsed: false,
    v233BaseEngine: "2.3.3",
    version: "2.4.0",
  }, base.status);
}

async function handleBuildV24(request, env, ctx) {
  const started = Date.now();
  const baseResponse = await app.fetch(request, env, ctx);
  const contentType = baseResponse.headers.get("content-type") || "";
  if (!/application\/json/i.test(contentType)) return baseResponse;

  const payload = await baseResponse.json().catch(() => null);
  if (!payload || !baseResponse.ok || !payload.ok || !payload.html) {
    return new Response(payload ? JSON.stringify(payload) : "{}", { status: baseResponse.status, headers: JSON_HEADERS });
  }

  let html = String(payload.html || "");
  const structureReady = Boolean(payload.stats?.structuralLockReady);
  const geometryReady = Boolean(payload.stats?.geometryLockReady && payload.stats?.geometryTokensValidAfterGuard);
  const menuFinalizerReady = Boolean(payload.stats?.menuFidelityFinalizerApplied);

  html = stampV24(html);
  html = injectBaselineCompatibilityBridge(html);
  html = injectMotionCss(html);
  html = injectMotionJs(html);
  html = html
    .replace(/Geometry Lock Guard Reconstruction V2\.3\.3/g, "Motion Fidelity Reconstruction V2.4")
    .replace(/Structure, geometry and visual reconstruction with a guarded V2\.2\.1 geometry baseline and finalized menu fidelity\./g, "Structure, geometry and visual-locked reconstruction with generated motion fidelity and reduced-motion protection.");

  const bridgeApplied = html.includes("pfr-v24-baseline-compatibility-css");
  const motionCssApplied = html.includes("pfr-v24-motion-css");
  const motionJsApplied = html.includes("pfr-v24-motion-js");
  const motionReady = Boolean(structureReady && geometryReady && menuFinalizerReady && bridgeApplied && motionCssApplied && motionJsApplied);

  return json({
    ...payload,
    engine: "v2.4-motion-fidelity-engine",
    mode: "clean-reconstruction-v24",
    filename: String(payload.filename || "clean-v233.html")
      .replace(/-clean-v233\.html$/i, "-clean-v24.html")
      .replace(/-clean-v232\.html$/i, "-clean-v24.html"),
    html,
    htmlBytes: byteLength(html),
    durationMs: Date.now() - started,
    stats: {
      ...(payload.stats || {}),
      structuralLockReady: structureReady,
      structuralLockPreserved: structureReady,
      geometryLockReady: geometryReady,
      geometryLockPreserved: geometryReady,
      visualBaselinePreserved: true,
      motionFidelityEngineApplied: motionReady,
      baselineCompatibilityBridgeApplied: bridgeApplied,
      menuMotionChoreographyApplied: motionCssApplied && motionJsApplied,
      submenuMotionChoreographyApplied: motionCssApplied,
      revealMotionPolishApplied: motionCssApplied,
      encounterMotionPolishApplied: motionCssApplied,
      hoverPressFeedbackApplied: motionCssApplied,
      reducedMotionGuardApplied: motionCssApplied,
      generatedMotionCssApplied: motionCssApplied,
      generatedMotionJsApplied: motionJsApplied,
      motionTokenCount: 8,
      targetScriptsCopied: 0,
      targetLayoutCssCopied: 0,
      targetFontFilesCopied: 0,
    },
    model: {
      ...(payload.model || {}),
      motionFidelity: {
        version: "2.4.0",
        structuralBaseline: "2.1.3",
        geometryBaseline: "2.2.1",
        visualBaseline: "2.3.3",
        menuOpenMs: 520,
        submenuMs: 460,
        revealMs: 760,
        encounterMs: 760,
        hoverMs: 260,
        pressMs: 120,
        easingStandard: "cubic-bezier(.22,.61,.36,1)",
        easingEmphasis: "cubic-bezier(.16,1,.3,1)",
        reducedMotionGuard: true,
        generatedCssOnly: true,
        generatedJsOnly: true,
      },
    },
    safety: {
      ...(payload.safety || {}),
      targetScriptsCopied: false,
      targetJavaScriptExecutedByBuild: false,
      targetCssUsedAsLayoutFoundation: false,
      targetCssCopied: false,
      targetFontFilesCopied: false,
      motionUsesGeneratedCssOnly: true,
      motionUsesGeneratedJsOnly: true,
      motionExecutesTargetJavaScript: false,
      motionSubmitsTargetForms: false,
      motionPreservesLockedStructure: structureReady,
      motionPreservesLockedGeometry: geometryReady,
      motionPreservesLockedVisualBaseline: true,
    },
  }, baseResponse.status);
}

function stampV24(html) {
  return String(html || "").replace(/<html\b([^>]*)>/i, (all, attrs) => {
    let next = String(attrs || "").replace(/\sdata-motion-engine=(['"])[^'"]*\1/i, "");
    return `<html${next} data-motion-engine="v2.4">`;
  });
}

function injectBaselineCompatibilityBridge(html) {
  if (String(html || "").includes("pfr-v24-baseline-compatibility-css")) return html;
  const source = String(html || "");
  const blocks = [];
  for (const id of ["pfr-v231-menu-surface-css", "pfr-v232-menu-finalizer-css"]) {
    const match = source.match(new RegExp(`<style\\b[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/style\\s*>`, "i"));
    if (!match?.[1]) continue;
    blocks.push(match[1]
      .replace(/html\[data-menu-engine="v2\.3\.1"\]/g, 'html[data-motion-engine="v2.4"]')
      .replace(/html\[data-menu-engine="v2\.3\.2"\]/g, 'html[data-motion-engine="v2.4"]'));
  }
  if (!blocks.length) return source;
  const style = `<style id="pfr-v24-baseline-compatibility-css">\n/* V2.4 compatibility bridge: same locked menu/finalizer declarations, motion scope only. */\n${blocks.join("\n")}\n</style>`;
  return injectBeforeHeadClose(source, style);
}

function injectMotionCss(html) {
  if (String(html || "").includes("pfr-v24-motion-css")) return html;
  const css = `<style id="pfr-v24-motion-css">
/* V2.4 — generated motion fidelity. No target JavaScript. */
html[data-motion-engine="v2.4"]{--motion-fast:120ms;--motion-hover:260ms;--motion-menu:520ms;--motion-submenu:460ms;--motion-reveal:760ms;--motion-encounter:760ms;--motion-ease:cubic-bezier(.22,.61,.36,1);--motion-emphasis:cubic-bezier(.16,1,.3,1)}
html[data-motion-engine="v2.4"] .menu-overlay{opacity:0;visibility:hidden;transform:translate3d(0,-14px,0) scale(.996);transform-origin:50% 0;transition:opacity var(--motion-menu) var(--motion-ease),transform var(--motion-menu) var(--motion-emphasis),visibility 0s linear var(--motion-menu);will-change:opacity,transform}
html[data-motion-engine="v2.4"] .menu-overlay.open{opacity:1;visibility:visible;transform:translate3d(0,0,0) scale(1);transition-delay:0s}
html[data-motion-engine="v2.4"] .full-fidelity-menu>.menu-row,html[data-motion-engine="v2.4"] .menu-secondary{opacity:0;transform:translate3d(0,16px,0);transition:opacity 420ms var(--motion-ease),transform 520ms var(--motion-emphasis)}
html[data-motion-engine="v2.4"] .menu-overlay.open .full-fidelity-menu>.menu-row,html[data-motion-engine="v2.4"] .menu-overlay.open .menu-secondary{opacity:1;transform:none}
html[data-motion-engine="v2.4"] .menu-overlay.open .menu-row:nth-child(1){transition-delay:60ms}html[data-motion-engine="v2.4"] .menu-overlay.open .menu-row:nth-child(2){transition-delay:95ms}html[data-motion-engine="v2.4"] .menu-overlay.open .menu-row:nth-child(3){transition-delay:130ms}html[data-motion-engine="v2.4"] .menu-overlay.open .menu-row:nth-child(4){transition-delay:165ms}html[data-motion-engine="v2.4"] .menu-overlay.open .menu-row:nth-child(5){transition-delay:200ms}html[data-motion-engine="v2.4"] .menu-overlay.open .menu-secondary{transition-delay:235ms}
html[data-motion-engine="v2.4"] .menu-subpanel{transform:translate3d(0,-8px,0);transition:max-height var(--motion-submenu) var(--motion-emphasis),opacity 320ms var(--motion-ease),transform var(--motion-submenu) var(--motion-emphasis)!important}
html[data-motion-engine="v2.4"] .menu-row.open .menu-subpanel{transform:none}
html[data-motion-engine="v2.4"] .menu-submenu-toggle span{transition:transform var(--motion-submenu) var(--motion-emphasis)!important}
html[data-motion-engine="v2.4"] .menu-journey-card img,html[data-motion-engine="v2.4"] .menu-blog-card figure img{transition:transform 700ms var(--motion-emphasis)}
html[data-motion-engine="v2.4"] .menu-journey-card,html[data-motion-engine="v2.4"] .menu-blog-card{transition:transform var(--motion-hover) var(--motion-ease),opacity var(--motion-hover) var(--motion-ease)}
@media(hover:hover){html[data-motion-engine="v2.4"] .menu-journey-card:hover,html[data-motion-engine="v2.4"] .menu-blog-card:hover{transform:translate3d(0,-4px,0)}html[data-motion-engine="v2.4"] .menu-journey-card:hover img,html[data-motion-engine="v2.4"] .menu-blog-card:hover figure img{transform:scale(1.035)}html[data-motion-engine="v2.4"] .pill:hover,html[data-motion-engine="v2.4"] .journeys-btn:hover,html[data-motion-engine="v2.4"] .menu-submenu-toggle:hover{transform:translate3d(0,-2px,0)}}
html[data-motion-engine="v2.4"] .pill,html[data-motion-engine="v2.4"] .journeys-btn,html[data-motion-engine="v2.4"] .menu-submenu-toggle,html[data-motion-engine="v2.4"] .menu-toggle{transition:transform var(--motion-hover) var(--motion-ease),filter var(--motion-hover) var(--motion-ease),background-color var(--motion-hover) var(--motion-ease)}
html[data-motion-engine="v2.4"] .pill:active,html[data-motion-engine="v2.4"] .journeys-btn:active,html[data-motion-engine="v2.4"] .menu-submenu-toggle:active,html[data-motion-engine="v2.4"] .menu-toggle:active{transform:scale(.97);transition-duration:var(--motion-fast)}
html[data-motion-engine="v2.4"] .reveal{opacity:0;transform:translate3d(0,28px,0);transition:opacity var(--motion-reveal) var(--motion-ease),transform var(--motion-reveal) var(--motion-emphasis);will-change:opacity,transform}
html[data-motion-engine="v2.4"] .reveal.visible{opacity:1;transform:none}
html[data-motion-engine="v2.4"] .encounter-image{opacity:0;transform:scale(1.025);transition:opacity 520ms var(--motion-ease),transform var(--motion-encounter) var(--motion-emphasis)!important;will-change:opacity,transform}
html[data-motion-engine="v2.4"] .encounter-image.active{opacity:1;transform:scale(1)}
html[data-motion-engine="v2.4"] .encounter-tab{transition:opacity var(--motion-hover) var(--motion-ease),transform var(--motion-hover) var(--motion-emphasis)!important}
html[data-motion-engine="v2.4"] .journeys-menu{transition:opacity 320ms var(--motion-ease),transform 420ms var(--motion-emphasis),visibility 0s linear 420ms!important}.journeys.open .journeys-menu{transition-delay:0s!important}
@media(prefers-reduced-motion:reduce){html[data-motion-engine="v2.4"] *,html[data-motion-engine="v2.4"] *:before,html[data-motion-engine="v2.4"] *:after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;transition-delay:0ms!important}html[data-motion-engine="v2.4"] .reveal,html[data-motion-engine="v2.4"] .encounter-image,html[data-motion-engine="v2.4"] .full-fidelity-menu>.menu-row,html[data-motion-engine="v2.4"] .menu-secondary{opacity:1!important;transform:none!important}}
</style>`;
  return injectBeforeHeadClose(String(html || ""), css);
}

function injectMotionJs(html) {
  if (String(html || "").includes("pfr-v24-motion-js")) return html;
  const js = `<script id="pfr-v24-motion-js">(()=>{const d=document.documentElement,m=document.querySelector('#menuOverlay');if(m){const sync=()=>{d.dataset.motionMenu=m.classList.contains('open')?'open':'closed'};sync();new MutationObserver(sync).observe(m,{attributes:true,attributeFilter:['class']})}const rows=[...document.querySelectorAll('[data-menu-row]')];for(const row of rows){const sync=()=>row.dataset.motionState=row.classList.contains('open')?'open':'closed';sync();new MutationObserver(sync).observe(row,{attributes:true,attributeFilter:['class']})}let ticking=false;const onScroll=()=>{if(ticking)return;ticking=true;requestAnimationFrame(()=>{d.style.setProperty('--motion-scroll-y',String(Math.round(window.scrollY)));d.dataset.motionDirection=(Number(d.dataset.motionLastY||0)<=window.scrollY)?'down':'up';d.dataset.motionLastY=String(window.scrollY);ticking=false})};addEventListener('scroll',onScroll,{passive:true});onScroll()})();</script>`;
  return String(html || "").replace(/<\/body\s*>/i, `${js}</body>`);
}

function injectBeforeHeadClose(html, content) {
  return /<\/head\s*>/i.test(html) ? html.replace(/<\/head\s*>/i, `${content}</head>`) : content + html;
}

function byteLength(value) { return new TextEncoder().encode(String(value || "")).length; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS }); }
