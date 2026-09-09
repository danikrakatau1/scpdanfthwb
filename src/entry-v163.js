import app from "./entry-v162.js";

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
        buildWebMode: "deep-rendered-snapshot-v14 + challenge-guard + visual-stabilized-raw-fallback-v163",
        renderedSnapshotBuild: true,
        challengeGuard: true,
        visualStabilizer: true,
        deferredStylesheetRecovery: true,
        loaderFinalizer: true,
        fidelityPass: true,
        heroMediaRecovery: true,
        responsiveHeadlineContainment: true,
        headlineStateFinalizer: true,
        dormantOverlayGuard: true,
        scrollPinNormalizer: true,
        safeJourneysMotion: true,
        staticCompatibilityLayer: "targeted-interactive-css",
        version: "1.6.3",
      });
    }

    if (url.pathname === "/api/build" && request.method === "POST") {
      const response = await app.fetch(request, env, ctx);
      const contentType = response.headers.get("content-type") || "";
      if (!/application\/json/i.test(contentType)) return response;

      const payload = await response.json().catch(() => null);
      if (!payload || !response.ok || !payload.ok || !payload.html) {
        return new Response(payload ? JSON.stringify(payload) : "{}", {
          status: response.status,
          headers: JSON_HEADERS,
        });
      }

      const fixed = applyStaticFlowAndJourneys(payload.html);
      return json({
        ...payload,
        mode: "visual-stabilized-static-reconstruction-v163",
        html: fixed,
        htmlBytes: byteLength(fixed),
        stats: {
          ...(payload.stats || {}),
          scrollPinNormalizerInjected: true,
          safeJourneysMotionInjected: true,
        },
        safety: {
          ...(payload.safety || {}),
          mapSectionReturnedToNormalFlow: true,
          journeysInteractionIsCssOnly: true,
          targetScriptsRemainDisabled: true,
        },
      });
    }

    if (url.pathname === "/api/scan" && request.method === "POST") {
      const response = await app.fetch(request, env, ctx);
      const contentType = response.headers.get("content-type") || "";
      if (!/application\/json/i.test(contentType)) return response;

      const report = await response.json().catch(() => null);
      if (!report) return response;

      if (report.buildWeb?.prebuilt?.html) {
        const html = applyStaticFlowAndJourneys(report.buildWeb.prebuilt.html);
        report.buildWeb.prebuilt = {
          ...report.buildWeb.prebuilt,
          mode: "sanitized-rendered-static-reconstruction-v163",
          html,
          htmlBytes: byteLength(html),
          stats: {
            ...(report.buildWeb.prebuilt.stats || {}),
            scrollPinNormalizerInjected: true,
            safeJourneysMotionInjected: true,
          },
        };
      }

      if (report.buildWeb?.available) {
        report.buildWeb = {
          ...(report.buildWeb || {}),
          scrollPinNormalizer: true,
          safeJourneysMotion: true,
          note: report.buildWeb?.challengeDetected
            ? "Rendered Browser Run hit a verification challenge. Build Web uses the safe raw fallback with V1.6.3 normal-flow map handling and CSS-only Journeys interaction; no challenge bypass is attempted."
            : "Build Web includes V1.6.3 normal-flow map handling and CSS-only Journeys interaction while target scripts remain disabled.",
        };
      }

      return json(report, response.status);
    }

    return app.fetch(request, env, ctx);
  },
};

function applyStaticFlowAndJourneys(input) {
  let html = String(input || "");

  html = html.replace(
    /<style\b[^>]*id=["']pfr-static-flow-journeys-v163["'][^>]*>[\s\S]*?<\/style\s*>/gi,
    ""
  );

  const css = `<style id="pfr-static-flow-journeys-v163">
/* V1.6.3 — sections that are pinned/animated by target JS must sit in normal
   document flow in the script-free reconstruction. */
.destinations-map-section{
  position:relative!important;
  top:auto!important;
  right:auto!important;
  bottom:auto!important;
  left:auto!important;
  inset:auto!important;
  transform:none!important;
  translate:none!important;
  scale:none!important;
  rotate:none!important;
  z-index:0!important;
  width:100%!important;
  min-height:100vh!important;
  min-height:100svh!important;
  overflow:hidden!important;
  margin-left:0!important;
  margin-right:0!important;
}
.destinations-map-section > .wp-block-cover__image-background{
  position:absolute!important;
  inset:0!important;
  width:100%!important;
  height:100%!important;
  max-width:none!important;
  transform:none!important;
  translate:none!important;
  scale:none!important;
  object-fit:cover!important;
  object-position:center center!important;
}
.destinations-map-section > .wp-block-cover__inner-container{
  position:relative!important;
  z-index:1!important;
  transform:none!important;
  translate:none!important;
}

/* V1.6.2 kept the floating Journeys submenu permanently hidden. Restore a
   safe click/focus interaction without re-enabling any target JavaScript. */
#journeys-floating-menu .submenu{
  display:block!important;
  visibility:hidden!important;
  opacity:0!important;
  pointer-events:none!important;
  transform:translateX(-50%) translateY(10px)!important;
  transition:opacity .28s ease,transform .32s cubic-bezier(.22,.61,.36,1),visibility 0s linear .32s!important;
}
#journeys-floating-menu .submenu ul{
  opacity:0!important;
  transform:translateY(6px)!important;
  transition:opacity .24s ease .04s,transform .28s ease .04s!important;
}
#journeys-floating-menu .submenu:before{
  transition:width .28s cubic-bezier(.22,.61,.36,1),height .28s cubic-bezier(.22,.61,.36,1)!important;
}
#journeys-floating-menu:focus-within .submenu{
  visibility:visible!important;
  opacity:1!important;
  pointer-events:auto!important;
  transform:translateX(-50%) translateY(-8px)!important;
  transition-delay:0s!important;
}
#journeys-floating-menu:focus-within .submenu ul{
  opacity:1!important;
  transform:translateY(0)!important;
}
#journeys-floating-menu:focus-within .submenu:before{
  width:100%!important;
  height:100%!important;
}
#journeys-floating-menu .journeys-btn{
  cursor:pointer!important;
  transition:transform .18s ease,box-shadow .22s ease!important;
}
#journeys-floating-menu .journeys-btn:active{
  transform:scale(.97)!important;
}
#journeys-floating-menu .journeys-btn:focus-visible{
  outline:2px solid rgba(23,26,72,.45)!important;
  outline-offset:3px!important;
}

@media screen and (max-width:768px){
  .destinations-map-section{
    min-height:100svh!important;
  }
  #journeys-floating-menu:focus-within .submenu{
    transform:translateX(-50%) translateY(-10px)!important;
  }
}
</style>`;

  if (/<\/head\s*>/i.test(html)) {
    html = html.replace(/<\/head\s*>/i, `${css}</head>`);
  } else {
    html = `${css}${html}`;
  }

  return html;
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
