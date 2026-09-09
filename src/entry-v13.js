import app from "./entry.js";

const MAX_BUILD_HTML_BYTES = 2_500_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
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
        buildWebMode: "raw-http-static-reconstruction-v13",
        staticCompatibilityLayer: true,
        version: "1.3.0",
      });
    }

    if (url.pathname === "/api/build" && request.method === "POST") {
      return handleBuildV13(request, env);
    }

    return app.fetch(request, env, ctx);
  },
};

async function handleBuildV13(request, env) {
  const authError = authorize(request, env);
  if (authError) return authError;

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Body must be valid JSON" }, 400);
  }

  let target;
  try {
    target = normalizePublicUrl(input?.url);
  } catch (error) {
    return json({ error: error.message, code: "INVALID_TARGET" }, 400);
  }

  const startedAt = Date.now();

  try {
    const fetched = await fetchWithValidatedRedirects(target);
    const response = fetched.response;
    const contentType = response.headers.get("content-type") || "";

    if (!response.ok) {
      return json({
        target: target.href,
        error: `Target returned HTTP ${response.status}`,
        code: "BUILD_TARGET_HTTP_ERROR",
        durationMs: Date.now() - startedAt,
      }, 502);
    }

    if (!/html|xhtml/i.test(contentType)) {
      return json({
        target: target.href,
        error: `Build Web requires an HTML document. Received ${contentType || "unknown content type"}.`,
        code: "BUILD_NOT_HTML",
      }, 415);
    }

    const rawHtml = await response.text();
    if (byteLength(rawHtml) > MAX_BUILD_HTML_BYTES) {
      return json({
        target: target.href,
        error: `Source HTML is too large. Limit is ${MAX_BUILD_HTML_BYTES} bytes.`,
        code: "BUILD_TOO_LARGE",
      }, 413);
    }

    const built = sanitizeStaticHtmlV13(rawHtml, fetched.finalUrl.href);
    const htmlBytes = byteLength(built.html);

    if (htmlBytes > MAX_BUILD_HTML_BYTES) {
      return json({
        target: target.href,
        error: `Sanitized reconstruction is too large (${htmlBytes} bytes). Limit is ${MAX_BUILD_HTML_BYTES} bytes.`,
        code: "BUILD_TOO_LARGE",
        stats: built.stats,
      }, 413);
    }

    return json({
      ok: true,
      target: target.href,
      finalUrl: fetched.finalUrl.href,
      builtAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      mode: "sanitized-raw-static-reconstruction-v13",
      source: "raw-http",
      browserQuotaUsed: false,
      filename: safeFilename(built.title || fetched.finalUrl.hostname) + ".html",
      htmlBytes,
      title: built.title,
      stats: built.stats,
      html: built.html,
      safety: {
        scriptsRemoved: true,
        framesRemoved: true,
        formSubmissionRemoved: true,
        inlineEventHandlersRemoved: true,
        javascriptUrlsRemoved: true,
        restrictiveCspInjected: true,
        remotePublicAssetsMayRemain: true,
        initialLoadersSuppressed: true,
        noscriptFallbacksRestored: true,
        lazyMediaPromoted: true,
      },
    });
  } catch (error) {
    return json({
      target: target.href,
      error: cleanError(error),
      code: "BUILD_FAILED",
      durationMs: Date.now() - startedAt,
    }, 502);
  }
}

async function fetchWithValidatedRedirects(initialUrl) {
  let current = new URL(initialUrl);
  const redirects = [];

  for (let i = 0; i <= MAX_REDIRECTS; i += 1) {
    assertPublicUrl(current);

    const response = await fetch(current.href, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
        "user-agent": "Passive-Fetch-Render-Auditor/1.3",
        dnt: "1",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: current, redirects };
    }

    const location = response.headers.get("location");
    if (!location) return { response, finalUrl: current, redirects };
    if (i === MAX_REDIRECTS) throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);

    const next = new URL(location, current);
    assertPublicUrl(next);
    redirects.push({ status: response.status, from: current.href, to: next.href });
    current = next;
  }

  throw new Error("Redirect processing failed");
}

function sanitizeStaticHtmlV13(input, sourceUrl) {
  const stats = {
    removedScripts: 0,
    unwrappedNoscript: 0,
    removedFrames: 0,
    transformedForms: 0,
    removedEventHandlers: 0,
    removedJavascriptUrls: 0,
    removedRefreshMeta: 0,
    removedResourceHints: 0,
    promotedLazySources: 0,
    suppressedLoaders: true,
    staticCompatibilityLayer: true,
    blockedWriteRequests: 0,
  };

  let html = String(input || "");

  // Keep useful fallback markup that sites place in <noscript> (often real images/content).
  html = html.replace(/<noscript\b[^>]*>([\s\S]*?)<\/noscript\s*>/gi, (_match, inner) => {
    stats.unwrappedNoscript += 1;
    return inner;
  });

  // Executable scripts are intentionally excluded from static reconstruction.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, () => {
    stats.removedScripts += 1;
    return "";
  });

  html = html.replace(/<(iframe|frame|object|embed|portal)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, () => {
    stats.removedFrames += 1;
    return "";
  });
  html = html.replace(/<(iframe|frame|object|embed|portal)\b[^>]*\/?\s*>/gi, () => {
    stats.removedFrames += 1;
    return "";
  });

  html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*(["'])?refresh\1?[^>]*>/gi, () => {
    stats.removedRefreshMeta += 1;
    return "";
  });
  html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*(["'])?content-security-policy\1?[^>]*>/gi, "");

  html = html.replace(/<link\b([^>]*\brel\s*=\s*(["'])(?:preload|prefetch|prerender|modulepreload|manifest)\2[^>]*)>/gi, () => {
    stats.removedResourceHints += 1;
    return "";
  });

  // Promote common lazy-load attributes so a no-JS page can still display its media.
  html = html.replace(/<(img|source)\b([^>]*)>/gi, (_match, tag, attrs) => {
    let next = attrs;
    const hasSrc = /(?:^|\s)src\s*=/i.test(next);
    const hasSrcset = /(?:^|\s)srcset\s*=/i.test(next);
    const dataSrc = next.match(/\sdata-src\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i)?.[1];
    const dataSrcset = next.match(/\sdata-srcset\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i)?.[1];

    if (!hasSrc && dataSrc) {
      next += ` src=${dataSrc}`;
      stats.promotedLazySources += 1;
    }
    if (!hasSrcset && dataSrcset) {
      next += ` srcset=${dataSrcset}`;
      stats.promotedLazySources += 1;
    }
    return `<${tag}${next}>`;
  });

  html = html.replace(/<form\b([^>]*)>/gi, (_match, attrs) => {
    stats.transformedForms += 1;
    const safeAttrs = stripDangerousAttributes(attrs, stats);
    return `<div${safeAttrs}>`;
  });
  html = html.replace(/<\/form\s*>/gi, "</div>");

  html = html.replace(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g, (_match, tag, attrs) => {
    return `<${tag}${stripDangerousAttributes(attrs, stats)}>`;
  });

  const compatibilityCss = `<style id="pfr-static-compat">
html,body{overflow:auto!important;overflow-y:auto!important;height:auto!important;min-height:100%!important;}
body{opacity:1!important;visibility:visible!important;}
#loader,#initial-loader,#page-loader,#site-loader,#preloader,
.loader-wrapper:has(>img[src*="initial-loader"]),
.initial-loader,.page-loader,.site-loader,.preloader,.loading-overlay,.splash-screen,
[id*="initial-loader"],[class*="initial-loader"]{
  display:none!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;
}
.gallery-container.hidden,.gallery-container[hidden]{display:block!important;visibility:visible!important;opacity:1!important;}
[data-aos],[data-reveal],[data-scroll-reveal],.reveal-on-scroll,.animate-on-scroll{
  opacity:1!important;visibility:visible!important;transform:none!important;
}
html.no-js .js-only{display:none!important;}
</style>`;

  const csp = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self' https: data: blob:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri https:; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; media-src https: data: blob:\">";
  const base = `<base href=\"${escapeAttribute(sourceUrl)}\">`;
  const generator = "<meta name=\"generator\" content=\"Passive Fetch / Render Auditor - static reconstruction v1.3\">";

  if (/<head\b[^>]*>/i.test(html)) {
    html = html.replace(/<head\b([^>]*)>/i, `<head$1>${csp}${base}${generator}${compatibilityCss}`);
  } else if (/<html\b[^>]*>/i.test(html)) {
    html = html.replace(/<html\b([^>]*)>/i, `<html$1><head>${csp}${base}${generator}${compatibilityCss}</head>`);
  } else {
    html = `<html><head>${csp}${base}${generator}${compatibilityCss}</head><body>${html}</body></html>`;
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = decodeEntities((titleMatch?.[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

  return {
    title,
    stats,
    html: `<!doctype html>\n<!-- Static reconstruction v1.3: scripts removed, no-JS fallbacks restored, loader suppressed, lazy media promoted. -->\n${html.replace(/^\s*<!doctype[^>]*>\s*/i, "")}`,
  };
}

function stripDangerousAttributes(attrs, stats) {
  let value = String(attrs || "");

  value = value.replace(/\s+on[a-z0-9:_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, () => {
    stats.removedEventHandlers += 1;
    return "";
  });

  value = value.replace(/\s+(?:srcdoc|formaction|action|method|contenteditable)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  value = value.replace(/\s+(href|src|xlink:href)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, () => {
    stats.removedJavascriptUrls += 1;
    return "";
  });
  value = value.replace(/\s+(href|src|xlink:href)\s*=\s*javascript:[^\s>]*/gi, () => {
    stats.removedJavascriptUrls += 1;
    return "";
  });

  return value;
}

function authorize(request, env) {
  if (!env.AUDIT_KEY) {
    return json({ error: "Server is not armed yet. Configure the AUDIT_KEY Worker secret first.", code: "AUDIT_KEY_MISSING" }, 503);
  }
  const auth = request.headers.get("authorization") || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!safeEqual(supplied, String(env.AUDIT_KEY))) {
    return json({ error: "Invalid access key", code: "UNAUTHORIZED" }, 401);
  }
  return null;
}

function normalizePublicUrl(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("A public URL is required.");
  let value = input.trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  assertPublicUrl(url);
  url.hash = "";
  return url;
}

function assertPublicUrl(url) {
  if (!isSafePublicUrl(url)) {
    throw new Error("Only public HTTP(S) URLs are allowed. Private, local, credential-bearing, or non-web targets are blocked.");
  }
}

function isSafePublicUrl(url) {
  if (!(url instanceof URL)) return false;
  if (!["http:", "https:"].includes(url.protocol)) return false;
  if (url.username || url.password) return false;

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split(".").map(Number);
    if (parts.some((x) => x < 0 || x > 255)) return false;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a >= 224) return false;
  }

  if (host.includes(":")) {
    const compact = host.replace(/^0+/, "");
    if (host === "::" || host === "::1" || /^f[cd]/i.test(host) || /^fe[89ab]/i.test(host)) return false;
    if (/^::ffff:(?:127\.|10\.|169\.254\.|192\.168\.)/i.test(compact)) return false;
  }

  return true;
}

function safeFilename(value) {
  const cleaned = String(value || "reconstructed-web")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return cleaned || "reconstructed-web";
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function escapeAttribute(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
}

function safeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function cleanError(error) {
  if (!error) return "Unknown error";
  const message = typeof error === "string" ? error : error.message || String(error);
  return message.slice(0, 500);
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
