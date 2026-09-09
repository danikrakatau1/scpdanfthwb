import app from "./entry-v151.js";

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
        buildWebMode: "deep-rendered-snapshot-v14 + challenge-guard + visual-stabilized-raw-fallback-v16",
        renderedSnapshotBuild: true,
        challengeGuard: true,
        visualStabilizer: true,
        deferredStylesheetRecovery: true,
        loaderFinalizer: true,
        fidelityPass: true,
        heroMediaRecovery: true,
        responsiveHeadlineContainment: true,
        staticCompatibilityLayer: "targeted",
        version: "1.6.0",
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

      const fidelity = applyFidelityPass(payload.html);
      return json({
        ...payload,
        mode: "visual-stabilized-static-reconstruction-v16",
        html: fidelity.html,
        htmlBytes: byteLength(fidelity.html),
        stats: {
          ...(payload.stats || {}),
          heroImagesPromoted: fidelity.stats.heroImagesPromoted,
          fidelityCssInjected: true,
          targetedHeroContainment: true,
        },
        safety: {
          ...(payload.safety || {}),
          fidelityPassIsCssAndMediaOnly: true,
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

      // If Deep Scan already produced a safe prebuilt snapshot, apply the same
      // visual-only fidelity layer here because the frontend consumes prebuilt
      // HTML directly and does not call /api/build again.
      if (report.buildWeb?.prebuilt?.html) {
        const fidelity = applyFidelityPass(report.buildWeb.prebuilt.html);
        report.buildWeb.prebuilt = {
          ...report.buildWeb.prebuilt,
          mode: "sanitized-rendered-static-reconstruction-v16",
          html: fidelity.html,
          htmlBytes: byteLength(fidelity.html),
          stats: {
            ...(report.buildWeb.prebuilt.stats || {}),
            heroImagesPromoted: fidelity.stats.heroImagesPromoted,
            fidelityCssInjected: true,
          },
        };
      }

      if (report.buildWeb?.available) {
        report.buildWeb = {
          ...(report.buildWeb || {}),
          fidelityPass: true,
          heroMediaRecovery: true,
          responsiveHeadlineContainment: true,
          note: report.buildWeb?.challengeDetected
            ? "Rendered Browser Run hit a verification challenge. Build Web uses the safe raw fallback with V1.6 hero/media fidelity fixes; no challenge bypass is attempted."
            : "Build Web includes the V1.6 targeted hero/media fidelity pass while keeping target scripts disabled.",
        };
      }

      return json(report, response.status);
    }

    return app.fetch(request, env, ctx);
  },
};

function applyFidelityPass(input) {
  let html = String(input || "");
  const stats = { heroImagesPromoted: 0 };

  // Promote only images inside common first-screen/hero wrappers. This avoids
  // globally defeating lazy loading while making static previews reliable on
  // mobile and inside sandboxed srcdoc/blob previews.
  html = html.replace(
    /(<(?:div|section|header)\b[^>]*class=["'][^"']*(?:featured-img|hero|hero-media|hero-image|masthead-media)[^"']*["'][^>]*>[\s\S]{0,1600}?<img\b)([^>]*>)/gi,
    (match, start, attrs) => {
      let next = attrs;
      if (/\bloading\s*=\s*(["'])lazy\1/i.test(next)) {
        next = next.replace(/\bloading\s*=\s*(["'])lazy\1/i, 'loading="eager"');
      } else if (!/\bloading\s*=/i.test(next)) {
        next = ` loading="eager"${next}`;
      }
      if (!/\bfetchpriority\s*=/i.test(next)) {
        next = ` fetchpriority="high"${next}`;
      }
      if (/\bsizes\s*=\s*(["'])auto,\s*100vw\1/i.test(next)) {
        next = next.replace(/\bsizes\s*=\s*(["'])auto,\s*100vw\1/i, 'sizes="100vw"');
      }
      stats.heroImagesPromoted += 1;
      return start + next;
    }
  );

  // Remove a previous copy when generated HTML is reprocessed.
  html = html.replace(
    /<style\b[^>]*id=["']pfr-static-fidelity-v16["'][^>]*>[\s\S]*?<\/style\s*>/gi,
    ""
  );

  const css = `<style id="pfr-static-fidelity-v16">
/* V1.6: targeted fidelity only. Do not reset global transforms/layout. */
.home .page-title-wrapper,
.page-title-wrapper{
  max-width:100vw!important;
  overflow:hidden!important;
  box-sizing:border-box!important;
}
.home .page-title-wrapper .container.large{
  width:min(1180px,calc(100vw - 80px))!important;
  max-width:calc(100vw - 80px)!important;
  margin-left:auto!important;
  margin-right:auto!important;
  grid-column:1/-1!important;
}
.home .page-title-wrapper .page-title{
  width:100%!important;
  max-width:1100px!important;
  margin-left:auto!important;
  margin-right:auto!important;
  white-space:normal!important;
  overflow-wrap:normal!important;
  word-break:normal!important;
  text-wrap:balance;
  font-size:clamp(3rem,5.6vw,5.25rem)!important;
  line-height:1.02!important;
}
.home .featured-img{
  display:block!important;
  width:100%!important;
  min-width:100%!important;
  overflow:hidden!important;
}
.home .featured-img img{
  display:block!important;
  visibility:visible!important;
  opacity:1!important;
  width:100%!important;
  height:100%!important;
  min-width:100%!important;
  object-fit:cover!important;
  object-position:center center!important;
}
@media screen and (max-width:768px){
  .home .page-title-wrapper{
    display:grid!important;
    align-content:center!important;
    width:100%!important;
    min-height:100svh!important;
    min-height:100vh!important;
    padding-left:20px!important;
    padding-right:20px!important;
  }
  .home .page-title-wrapper .container.large{
    width:100%!important;
    max-width:100%!important;
    margin:0 auto!important;
    grid-column:1/-1!important;
  }
  .home .page-title-wrapper .page-title{
    display:block!important;
    visibility:visible!important;
    opacity:1!important;
    max-width:520px!important;
    margin-left:auto!important;
    margin-right:auto!important;
    font-size:clamp(2.45rem,11vw,3.625rem)!important;
    line-height:1.02!important;
  }
  .home .featured-img{
    display:block!important;
    visibility:visible!important;
    opacity:1!important;
    height:100svh!important;
    height:100vh!important;
    min-height:100svh!important;
    min-height:100vh!important;
    background:#59504f!important;
  }
  .home .featured-img img{
    display:block!important;
    visibility:visible!important;
    opacity:1!important;
    width:100%!important;
    height:100%!important;
    min-height:100%!important;
    max-width:none!important;
    object-fit:cover!important;
    object-position:center center!important;
  }
  #journeys-floating-menu{
    left:50%!important;
    bottom:28px!important;
    transform:translateX(-50%)!important;
  }
}
</style>`;

  if (/<\/head\s*>/i.test(html)) {
    html = html.replace(/<\/head\s*>/i, `${css}</head>`);
  } else {
    html = `${css}${html}`;
  }

  return { html, stats };
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
