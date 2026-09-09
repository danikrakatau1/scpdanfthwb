import app from "./entry-v15.js";

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
        buildWebMode: "deep-rendered-snapshot-v14 + challenge-guard + visual-stabilized-raw-fallback-v151",
        renderedSnapshotBuild: true,
        challengeGuard: true,
        visualStabilizer: true,
        deferredStylesheetRecovery: true,
        loaderFinalizer: true,
        staticCompatibilityLayer: "conservative",
        version: "1.5.1",
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

      const finalized = finalizeStaticLoader(payload.html);
      return json({
        ...payload,
        mode: "visual-stabilized-raw-static-reconstruction-v151",
        html: finalized.html,
        htmlBytes: new TextEncoder().encode(finalized.html).byteLength,
        stats: {
          ...(payload.stats || {}),
          loaderFinalizerInjected: true,
          realLoaderSuppressed: true,
          inertAjaxOverlaySuppressed: true,
        },
        safety: {
          ...(payload.safety || {}),
          staticLoaderSuppressed: true,
          ajaxLoadingOverlayDisabled: true,
        },
      });
    }

    if (url.pathname === "/api/scan" && request.method === "POST") {
      const response = await app.fetch(request, env, ctx);
      const contentType = response.headers.get("content-type") || "";
      if (!/application\/json/i.test(contentType)) return response;
      const report = await response.json().catch(() => null);
      if (!report) return response;

      if (report.buildWeb?.source?.includes("raw-http") || report.buildWeb?.challengeDetected) {
        report.buildWeb = {
          ...(report.buildWeb || {}),
          mode: "visual-stabilized-raw-static-reconstruction-v151",
          loaderFinalizer: true,
          note: report.buildWeb?.challengeDetected
            ? "Rendered Browser Run hit a verification challenge. Build Web uses the safe raw fallback with deferred stylesheet recovery and final loader suppression; no challenge bypass is attempted."
            : "Build Web uses the visual-stabilized raw fallback with deferred stylesheet recovery and final loader suppression.",
        };
      }

      return json(report, response.status);
    }

    return app.fetch(request, env, ctx);
  },
};

function finalizeStaticLoader(input) {
  let html = String(input || "");

  // Must come AFTER recovered site CSS so the original #loader rule cannot
  // re-enable the full-screen loader in a script-free static reconstruction.
  const css = `<style id="pfr-static-loader-finalizer-v151">
/* Static build: runtime loaders have no corresponding JS lifecycle. */
#loader,
body > #loader,
#loader .loader-wrapper,
#initial-loader,.initial-loader,
#page-loader,.page-loader,
#site-loader,.site-loader,
#preloader,.preloader{
  display:none!important;
  visibility:hidden!important;
  opacity:0!important;
  pointer-events:none!important;
  width:0!important;
  height:0!important;
  min-width:0!important;
  min-height:0!important;
  overflow:hidden!important;
}
#main-content::after,
#main-content:after{
  display:none!important;
  content:none!important;
  opacity:0!important;
  visibility:hidden!important;
  pointer-events:none!important;
}
</style>`;

  // Avoid duplicate finalizers when a generated HTML file is reprocessed.
  html = html.replace(/<style\b[^>]*id=["']pfr-static-loader-finalizer-v151["'][^>]*>[\s\S]*?<\/style\s*>/gi, "");

  if (/<\/head\s*>/i.test(html)) {
    html = html.replace(/<\/head\s*>/i, `${css}</head>`);
  } else {
    html = `${css}${html}`;
  }

  return { html };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
