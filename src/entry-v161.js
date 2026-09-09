import app from "./entry-v16.js";

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
        buildWebMode: "deep-rendered-snapshot-v14 + challenge-guard + visual-stabilized-raw-fallback-v161",
        renderedSnapshotBuild: true,
        challengeGuard: true,
        visualStabilizer: true,
        deferredStylesheetRecovery: true,
        loaderFinalizer: true,
        fidelityPass: true,
        heroMediaRecovery: true,
        responsiveHeadlineContainment: true,
        headlineStateFinalizer: true,
        staticCompatibilityLayer: "targeted",
        version: "1.6.1",
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

      const finalized = finalizeHeroHeadline(payload.html);
      return json({
        ...payload,
        mode: "visual-stabilized-static-reconstruction-v161",
        html: finalized,
        htmlBytes: byteLength(finalized),
        stats: {
          ...(payload.stats || {}),
          headlineStateFinalizerInjected: true,
        },
        safety: {
          ...(payload.safety || {}),
          headlineFixIsCssOnly: true,
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
        const html = finalizeHeroHeadline(report.buildWeb.prebuilt.html);
        report.buildWeb.prebuilt = {
          ...report.buildWeb.prebuilt,
          mode: "sanitized-rendered-static-reconstruction-v161",
          html,
          htmlBytes: byteLength(html),
          stats: {
            ...(report.buildWeb.prebuilt.stats || {}),
            headlineStateFinalizerInjected: true,
          },
        };
      }

      if (report.buildWeb?.available) {
        report.buildWeb = {
          ...(report.buildWeb || {}),
          headlineStateFinalizer: true,
          note: report.buildWeb?.challengeDetected
            ? "Rendered Browser Run hit a verification challenge. Build Web uses the safe raw fallback with V1.6.1 targeted hero headline state finalization; no challenge bypass is attempted."
            : "Build Web includes V1.6.1 targeted hero headline state finalization while target scripts remain disabled.",
        };
      }

      return json(report, response.status);
    }

    return app.fetch(request, env, ctx);
  },
};

function finalizeHeroHeadline(input) {
  let html = String(input || "");

  html = html.replace(
    /<style\b[^>]*id=["']pfr-static-headline-finalizer-v161["'][^>]*>[\s\S]*?<\/style\s*>/gi,
    ""
  );

  const css = `<style id="pfr-static-headline-finalizer-v161">
/* V1.6.1 — finalise only the hero headline's animation/runtime state. */
.home .page-title-wrapper .container.large,
.home .page-title-wrapper .page-title{
  transform:none!important;
  translate:none!important;
  scale:none!important;
  rotate:none!important;
  clip-path:none!important;
  mask:none!important;
  filter:none!important;
}
.home .page-title-wrapper .container.large{
  position:relative!important;
  left:auto!important;
  right:auto!important;
  top:auto!important;
  bottom:auto!important;
  width:calc(100vw - 80px)!important;
  max-width:1100px!important;
  min-width:0!important;
  margin-left:auto!important;
  margin-right:auto!important;
  box-sizing:border-box!important;
}
.home .page-title-wrapper .page-title{
  position:relative!important;
  left:auto!important;
  right:auto!important;
  top:auto!important;
  bottom:auto!important;
  width:100%!important;
  max-width:100%!important;
  min-width:0!important;
  margin-left:auto!important;
  margin-right:auto!important;
  padding-left:0!important;
  padding-right:0!important;
  box-sizing:border-box!important;
  white-space:normal!important;
  overflow:visible!important;
  overflow-wrap:normal!important;
  word-break:normal!important;
  text-indent:0!important;
  letter-spacing:normal!important;
  text-align:center!important;
  font-size:clamp(42px,5.25vw,76px)!important;
  line-height:1.04!important;
}
@media screen and (max-width:768px){
  .home .page-title-wrapper{
    overflow:hidden!important;
  }
  .home .page-title-wrapper .container.large{
    width:calc(100vw - 40px)!important;
    max-width:calc(100vw - 40px)!important;
    min-width:0!important;
    margin-left:auto!important;
    margin-right:auto!important;
  }
  .home .page-title-wrapper .page-title{
    width:100%!important;
    max-width:100%!important;
    min-width:0!important;
    font-size:clamp(30px,10vw,42px)!important;
    line-height:1.08!important;
  }
}
@media screen and (max-width:420px){
  .home .page-title-wrapper .container.large{
    width:calc(100vw - 32px)!important;
    max-width:calc(100vw - 32px)!important;
  }
  .home .page-title-wrapper .page-title{
    font-size:clamp(28px,9.5vw,38px)!important;
    line-height:1.1!important;
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
