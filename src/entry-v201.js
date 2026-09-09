import app from "./entry-v2.js";

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
        buildWebV1Configured: true,
        buildWebV2Configured: true,
        buildWebMode: "v2-clean-reconstruction + v1-static-snapshot-fallback",
        cleanReconstructionEngine: true,
        cleanReconstructionUsesTargetScripts: false,
        cleanReconstructionUsesTargetCssAsLayout: false,
        cleanReconstructionBrowserQuotaUsed: false,
        cleanHeroMediaBinding: true,
        v1CompatibilityEngine: "1.6.3",
        version: "2.0.1",
      });
    }

    if (url.pathname === "/api/build-v2" && request.method === "POST") {
      const response = await app.fetch(request, env, ctx);
      const contentType = response.headers.get("content-type") || "";
      if (!/application\/json/i.test(contentType)) return response;
      const payload = await response.json().catch(() => null);
      if (!payload || !response.ok || !payload.ok || !payload.html) {
        return new Response(payload ? JSON.stringify(payload) : "{}", { status: response.status, headers: JSON_HEADERS });
      }

      const fixed = bindHeroMedia(payload.html);
      return json({
        ...payload,
        html: fixed,
        htmlBytes: byteLength(fixed),
        stats: { ...(payload.stats || {}), cleanHeroMediaBinding: true },
      }, response.status);
    }

    return app.fetch(request, env, ctx);
  },
};

function bindHeroMedia(input) {
  let html = String(input || "");
  let heroUrl = "";

  html = html.replace(/}\s*style="--hero-image:url\('([^']+)'\)"\.hero:before/i, (_match, url) => {
    heroUrl = url;
    return "}.hero:before";
  });

  if (heroUrl && /<section\s+class="hero">/i.test(html)) {
    const safe = heroUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    html = html.replace(/<section\s+class="hero">/i, `<section class="hero" style="--hero-image:url('${safe}')">`);
  }

  return html;
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
