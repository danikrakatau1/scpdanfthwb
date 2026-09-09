import app from "./entry-v201.js";

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
        cleanPaletteGuard: true,
        cleanNavigationRecovery: true,
        cleanLongHeadingGuard: true,
        v1CompatibilityEngine: "1.6.3",
        version: "2.0.2",
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

      const polished = polishCleanHtml(payload.html);
      return json({
        ...payload,
        html: polished.html,
        htmlBytes: byteLength(polished.html),
        stats: {
          ...(payload.stats || {}),
          cleanPaletteGuardApplied: polished.stats.paletteAdjusted,
          cleanNavigationRecovered: polished.stats.navigationRecovered,
          noisySectionsRemoved: polished.stats.noisySectionsRemoved,
        },
      }, response.status);
    }

    return app.fetch(request, env, ctx);
  },
};

function polishCleanHtml(input) {
  let html = String(input || "");
  const stats = { paletteAdjusted: false, navigationRecovered: false, noisySectionsRemoved: 0 };

  const root = html.match(/:root\{--primary:(#[0-9a-f]{6});--ink:(#[0-9a-f]{6});--surface:(#[0-9a-f]{6})/i);
  if (root) {
    const [, primary, ink, surface] = root;
    const primaryLum = luminance(primary);
    const inkLum = luminance(ink);
    let nextPrimary = primary;
    let nextInk = ink;
    let nextSurface = surface;
    if (primaryLum > 0.62) nextPrimary = "#171a48";
    if (inkLum > 0.48) nextInk = "#202127";
    if (luminance(surface) > 0.96) nextSurface = "#f4f2ee";
    if (nextPrimary !== primary || nextInk !== ink || nextSurface !== surface) {
      html = html.replace(root[0], `:root{--primary:${nextPrimary};--ink:${nextInk};--surface:${nextSurface}`);
      stats.paletteAdjusted = true;
    }
  }

  const menuMatch = html.match(/<nav class="explore-menu"[^>]*>([\s\S]*?)<\/nav>/i);
  if (menuMatch && /^\s*(?:<a[^>]*>(?:EN|PT)<\/a>\s*)+$/i.test(menuMatch[1])) {
    const candidates = [];
    const re = /<a class="pill" href="([^"]+)">([^<]{2,60})<\/a>/gi;
    let match;
    while ((match = re.exec(html)) && candidates.length < 6) {
      const label = decode(match[2]).trim();
      if (/^(?:read|learn|explore map)$/i.test(label)) continue;
      if (!candidates.some((item) => item.href === match[1] || item.label === label)) candidates.push({ href: match[1], label });
    }
    if (candidates.length >= 3) {
      const nav = candidates.map((item) => `<a href="${item.href}">${escapeHtml(item.label)}</a>`).join("");
      html = html.replace(menuMatch[0], `<nav class="explore-menu" aria-label="Public page navigation">${nav}</nav>`);
      stats.navigationRecovered = true;
    }
  }

  html = html.replace(/<section class="section reveal"><div class="section-inner(?: feature-grid)?">[\s\S]*?<h2>([^<]{121,})<\/h2>[\s\S]*?<\/section>/gi, () => {
    stats.noisySectionsRemoved += 1;
    return "";
  });

  return { html, stats };
}

function luminance(hex) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255).map((x) => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function decode(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
