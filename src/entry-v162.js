import app from "./entry-v161.js";

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
        buildWebMode: "deep-rendered-snapshot-v14 + challenge-guard + visual-stabilized-raw-fallback-v162",
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
        staticCompatibilityLayer: "targeted",
        version: "1.6.2",
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

      const guarded = applyDormantOverlayGuard(payload.html);
      return json({
        ...payload,
        mode: "visual-stabilized-static-reconstruction-v162",
        html: guarded.html,
        htmlBytes: byteLength(guarded.html),
        stats: {
          ...(payload.stats || {}),
          dormantOverlayGuardInjected: true,
          dormantOverlaysFinalized: guarded.stats.overlaysFinalized,
        },
        safety: {
          ...(payload.safety || {}),
          dormantInteractiveOverlaysClosed: true,
          journeysFloatingButtonPreserved: true,
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
        const guarded = applyDormantOverlayGuard(report.buildWeb.prebuilt.html);
        report.buildWeb.prebuilt = {
          ...report.buildWeb.prebuilt,
          mode: "sanitized-rendered-static-reconstruction-v162",
          html: guarded.html,
          htmlBytes: byteLength(guarded.html),
          stats: {
            ...(report.buildWeb.prebuilt.stats || {}),
            dormantOverlayGuardInjected: true,
            dormantOverlaysFinalized: guarded.stats.overlaysFinalized,
          },
        };
      }

      if (report.buildWeb?.available) {
        report.buildWeb = {
          ...(report.buildWeb || {}),
          dormantOverlayGuard: true,
          note: report.buildWeb?.challengeDetected
            ? "Rendered Browser Run hit a verification challenge. Build Web uses the safe raw fallback with V1.6.2 dormant overlay finalization; no challenge bypass is attempted."
            : "Build Web includes V1.6.2 dormant overlay finalization while target scripts remain disabled.",
        };
      }

      return json(report, response.status);
    }

    return app.fetch(request, env, ctx);
  },
};

function applyDormantOverlayGuard(input) {
  let html = String(input || "");
  const stats = { overlaysFinalized: 0 };

  // Finalize known JS-driven overlays to their closed state in the HTML itself.
  // This protects against captured/open runtime classes or inline styles.
  for (const id of ["full-menu", "contact-form-modal-wrapper"]) {
    const re = new RegExp(`<([a-zA-Z][\\w:-]*)\\b([^>]*\\bid=["']${escapeRegExp(id)}["'][^>]*)>`, "gi");
    html = html.replace(re, (_match, tag, attrs) => {
      stats.overlaysFinalized += 1;
      let next = attrs;
      const closeStyle = "display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;";

      if (/\bstyle\s*=\s*(["'])/i.test(next)) {
        next = next.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/i, (_m, quote, styleValue) => {
          return `style=${quote}${styleValue};${closeStyle}${quote}`;
        });
      } else {
        next += ` style="${closeStyle}"`;
      }

      if (!/\baria-hidden\s*=/i.test(next)) next += ' aria-hidden="true"';
      return `<${tag}${next}>`;
    });
  }

  // Avoid duplicate guard styles on regenerated HTML.
  html = html.replace(
    /<style\b[^>]*id=["']pfr-static-overlay-guard-v162["'][^>]*>[\s\S]*?<\/style\s*>/gi,
    ""
  );

  const css = `<style id="pfr-static-overlay-guard-v162">
/* V1.6.2 — JS-driven overlays must remain dormant in a script-free build. */
#full-menu,
#contact-form-modal-wrapper{
  display:none!important;
  visibility:hidden!important;
  opacity:0!important;
  pointer-events:none!important;
  transform:none!important;
}
#full-menu *,
#contact-form-modal-wrapper *{
  pointer-events:none!important;
}
/* The floating Journeys control belongs to the page itself; keep the button,
   but its JS-only submenu must stay closed in the static reconstruction. */
#journeys-floating-menu .submenu{
  visibility:hidden!important;
  opacity:0!important;
  pointer-events:none!important;
}
</style>`;

  if (/<\/head\s*>/i.test(html)) {
    html = html.replace(/<\/head\s*>/i, `${css}</head>`);
  } else {
    html = `${css}${html}`;
  }

  return { html, stats };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
