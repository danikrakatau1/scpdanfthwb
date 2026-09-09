import app from "./entry-v141.js";

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
        buildWebMode: "deep-rendered-snapshot-v14 + challenge-guard + visual-stabilized-raw-fallback-v15",
        renderedSnapshotBuild: true,
        challengeGuard: true,
        visualStabilizer: true,
        deferredStylesheetRecovery: true,
        staticCompatibilityLayer: "conservative",
        version: "1.5.0",
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

      const stabilized = stabilizeStaticHtml(payload.html);
      return json({
        ...payload,
        mode: "visual-stabilized-raw-static-reconstruction-v15",
        source: "raw-http-visual-stabilized",
        html: stabilized.html,
        htmlBytes: new TextEncoder().encode(stabilized.html).byteLength,
        stats: {
          ...(payload.stats || {}),
          activatedDeferredStylesheets: stabilized.stats.activatedDeferredStylesheets,
          removedAggressiveCompatibilityLayer: stabilized.stats.removedAggressiveCompatibilityLayer,
          conservativeCompatibilityLayer: true,
        },
        safety: {
          ...(payload.safety || {}),
          originalExecutableScriptsRemainDisabled: true,
          deferredStylesheetMediaRecovered: true,
          aggressiveTransformResetRemoved: true,
        },
      });
    }

    if (url.pathname === "/api/scan" && request.method === "POST") {
      const response = await app.fetch(request, env, ctx);
      const contentType = response.headers.get("content-type") || "";
      if (!/application\/json/i.test(contentType)) return response;

      const report = await response.json().catch(() => null);
      if (!report) return response;

      if (report.buildWeb?.source === "raw-http-fallback" || report.buildWeb?.challengeDetected) {
        report.buildWeb = {
          ...(report.buildWeb || {}),
          mode: "visual-stabilized-raw-static-reconstruction-v15",
          source: "raw-http-visual-stabilized-fallback",
          note: report.buildWeb?.challengeDetected
            ? "Browser Run received a verification/challenge page, so the rendered snapshot was rejected. Build Web will use the V1.5 visual-stabilized raw HTTP fallback. No challenge bypass is attempted."
            : "Rendered snapshot is unavailable, so Build Web will use the V1.5 visual-stabilized raw HTTP fallback.",
        };
      }

      return json(report, response.status);
    }

    return app.fetch(request, env, ctx);
  },
};

function stabilizeStaticHtml(input) {
  let html = String(input || "");
  const stats = {
    activatedDeferredStylesheets: 0,
    removedAggressiveCompatibilityLayer: false,
  };

  // V1.3 used a broad compatibility layer that could reset transforms and
  // layout states. V1.5 removes it and replaces it with a deliberately narrow
  // static-only layer.
  html = html.replace(/<style\b[^>]*id=["']pfr-static-compat["'][^>]*>[\s\S]*?<\/style\s*>/gi, () => {
    stats.removedAggressiveCompatibilityLayer = true;
    return "";
  });

  // A common performance pattern is:
  //   <link rel="stylesheet" media="print" onload="this.media='all'">
  // Sanitization correctly removes onload, but that would leave the real
  // stylesheet permanently print-only. Static builds safely promote such
  // stylesheet links to media=all without restoring executable JS.
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const isStylesheet = /\brel\s*=\s*(["'])[^"']*stylesheet[^"']*\1/i.test(tag) || /\brel\s*=\s*stylesheet\b/i.test(tag);
    const isPrint = /\bmedia\s*=\s*(["'])print\1/i.test(tag) || /\bmedia\s*=\s*print\b/i.test(tag);
    if (!isStylesheet || !isPrint) return tag;

    stats.activatedDeferredStylesheets += 1;
    return tag.replace(/\bmedia\s*=\s*(["'])print\1/i, 'media="all"').replace(/\bmedia\s*=\s*print\b/i, 'media="all"');
  });

  const conservativeCss = `<style id="pfr-static-visual-v15">
/* Passive static compatibility only. Preserve the site's own layout CSS. */
html,body{overflow-y:auto!important;}
body{opacity:1!important;visibility:visible!important;}
#initial-loader,.initial-loader,[id="initial-loader"],[class~="initial-loader"],
#page-loader,.page-loader,#site-loader,.site-loader,#preloader,.preloader{
  display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;
}
img[loading="lazy"]{content-visibility:auto;}
</style>`;

  if (/<\/head\s*>/i.test(html)) {
    html = html.replace(/<\/head\s*>/i, `${conservativeCss}</head>`);
  } else {
    html = `${conservativeCss}${html}`;
  }

  return { html, stats };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
