import app from "./entry-v231.js";

const MAX_SOURCE_BYTES = 2_500_000;
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") return handleHealth(request, env, ctx);
    if (url.pathname === "/api/build-v2" && request.method === "POST") return handleBuildV232(request, env, ctx);
    return app.fetch(request, env, ctx);
  },
};

async function handleHealth(request, env, ctx) {
  const base = await app.fetch(request, env, ctx);
  const payload = await base.json().catch(() => ({}));
  return json({
    ...payload,
    buildWebMode: "v2.3.2-menu-fidelity-finalizer + v2.3.1-menu-surface-fidelity + v2.3-visual-fidelity + v2.2.1-geometry-baseline + v2.1.3-structure-baseline + v1-static-snapshot",
    structuralLockBaseline: "2.1.3",
    geometryLockBaseline: "2.2.1",
    visualBaselineCandidate: "2.3.2",
    structuralLockPreserved: true,
    geometryLockPreserved: true,
    visualFidelityEngine: true,
    menuSurfaceFidelityPolish: true,
    menuFidelityFinalizer: true,
    blogMetadataFinalizer: true,
    blogSeeAllRecovery: true,
    destinationsMenuFinalizer: true,
    destinationsLabelClickable: true,
    destinationsSubmenuAssetRecovery: true,
    destinationsSubmenuGeometryRecovery: true,
    menuFinalizerSourceRefetch: true,
    generatedMenuCssOnly: true,
    generatedMenuJsOnly: true,
    visualCopiesTargetCss: false,
    cleanReconstructionUsesTargetScripts: false,
    cleanReconstructionUsesTargetCssAsLayout: false,
    cleanReconstructionBrowserQuotaUsed: false,
    v231BaseEngine: "2.3.1",
    v23BaseEngine: "2.3.0",
    v221BaseEngine: "2.2.1",
    v213BaseEngine: "2.1.3",
    version: "2.3.2",
  }, base.status);
}

async function handleBuildV232(request, env, ctx) {
  const started = Date.now();
  const baseResponse = await app.fetch(request, env, ctx);
  const contentType = baseResponse.headers.get("content-type") || "";
  if (!/application\/json/i.test(contentType)) return baseResponse;

  const payload = await baseResponse.json().catch(() => null);
  if (!payload || !baseResponse.ok || !payload.ok || !payload.html) {
    return new Response(payload ? JSON.stringify(payload) : "{}", {
      status: baseResponse.status,
      headers: JSON_HEADERS,
    });
  }

  let html = String(payload.html || "");
  const baseHref = payload.finalUrl || payload.target || "";
  const source = await refetchPublicHtml(baseHref);
  const finalizer = source ? extractFinalizerModel(source, baseHref) : null;

  let blogMetaFixed = 0;
  let blogSeeAllApplied = false;
  let destinationsApplied = false;

  if (finalizer) {
    const metaResult = finalizeBlogMetadata(html, finalizer.blog);
    html = metaResult.html;
    blogMetaFixed = metaResult.count;

    const ctaResult = finalizeBlogSeeAll(html, finalizer.blogSeeAll);
    html = ctaResult.html;
    blogSeeAllApplied = ctaResult.applied;

    const destResult = finalizeDestinations(html, finalizer.destinations);
    html = destResult.html;
    destinationsApplied = destResult.applied;
  }

  html = stampV232(html);
  html = injectFinalizerCss(html, finalizer?.destinations?.geometry);
  html = html
    .replace(/Menu & Surface Fidelity Reconstruction V2\.3\.1/g, "Menu Fidelity Finalizer Reconstruction V2.3.2")
    .replace(/Structure and geometry-locked reconstruction with generated menu and surface fidelity polish from public page signals\./g, "Structure and geometry-locked reconstruction with generated menu fidelity finalization from public page signals.");

  const structureReady = Boolean(payload.stats?.structuralLockReady);
  const geometryReady = Boolean(payload.stats?.geometryLockReady);
  const visualReady = Boolean(payload.stats?.visualFidelityEngineApplied);
  const menuBaseReady = Boolean(payload.stats?.menuSurfaceFidelityPolishApplied);
  const blogTargetCount = finalizer?.blog?.length || 0;
  const blogMetadataReady = blogTargetCount > 0 && blogMetaFixed === blogTargetCount;
  const destinationReady = Boolean(finalizer?.destinations?.href && destinationsApplied);
  const finalizerCssApplied = html.includes("pfr-v232-menu-finalizer-css");
  const finalizerReady = Boolean(
    menuBaseReady &&
    finalizer &&
    blogMetadataReady &&
    blogSeeAllApplied &&
    destinationReady &&
    finalizerCssApplied
  );

  return json({
    ...payload,
    engine: "v2.3.2-menu-fidelity-finalizer",
    mode: "clean-reconstruction-v232",
    filename: String(payload.filename || "clean-v231.html")
      .replace(/-clean-v231\.html$/i, "-clean-v232.html")
      .replace(/-clean-v23\.html$/i, "-clean-v232.html"),
    html,
    htmlBytes: byteLength(html),
    durationMs: Date.now() - started,
    stats: {
      ...(payload.stats || {}),
      structuralLockReady: structureReady,
      structuralLockPreserved: structureReady,
      geometryLockReady: geometryReady,
      geometryLockPreserved: geometryReady,
      visualFidelityEngineApplied: visualReady,
      menuSurfaceFidelityPolishApplied: menuBaseReady,
      menuFinalizerSourceRefetchUsed: Boolean(source),
      menuFidelityFinalizerApplied: finalizerReady,
      blogMetadataFinalizerApplied: blogMetadataReady,
      blogMetadataCardsFixed: blogMetaFixed,
      blogSeeAllRecovered: blogSeeAllApplied,
      destinationsMenuFinalizerApplied: destinationReady,
      destinationsLabelClickable: destinationReady,
      destinationsSubmenuAssetRecovered: Boolean(finalizer?.destinations?.mapImage),
      destinationsSubmenuGeometryRecovered: Boolean(finalizer?.destinations?.geometry),
      finalizerGeneratedCssApplied: finalizerCssApplied,
      targetScriptsCopied: 0,
      targetLayoutCssCopied: 0,
      targetFontFilesCopied: 0,
    },
    model: {
      ...(payload.model || {}),
      menuFidelityFinalizer: finalizer ? {
        version: "2.3.2",
        structuralBaseline: "2.1.3",
        geometryBaseline: "2.2.1",
        visualBase: "2.3.0",
        menuBase: "2.3.1",
        blogCards: finalizer.blog,
        blogSeeAll: finalizer.blogSeeAll,
        destinations: finalizer.destinations,
        generatedCssOnly: true,
        generatedJsOnly: true,
        targetCssCopied: false,
        targetScriptsCopied: false,
      } : null,
    },
    safety: {
      ...(payload.safety || {}),
      targetScriptsCopied: false,
      targetJavaScriptExecutedByBuild: false,
      targetCssUsedAsLayoutFoundation: false,
      targetCssCopied: false,
      targetFontFilesCopied: false,
      menuFinalizerUsesPublicMarkupOnly: true,
      menuFinalizerUsesNumericPublicCssSignalsOnly: true,
      menuFinalizerOutputUsesGeneratedCssOnly: true,
      menuFinalizerExecutesTargetJavaScript: false,
      menuFinalizerSubmitsTargetForms: false,
      visualFidelityPreservesLockedStructure: true,
      visualFidelityPreservesLockedGeometry: true,
    },
  }, baseResponse.status);
}

async function refetchPublicHtml(value) {
  try {
    const url = new URL(value);
    if (!isSafePublicUrl(url)) return "";
    const response = await fetch(url.href, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "user-agent": "Passive-Fetch-Render-Auditor/2.3.2 Menu-Finalizer",
        dnt: "1",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok || !/html|xhtml/i.test(response.headers.get("content-type") || "")) return "";
    const text = await response.text();
    return byteLength(text) <= MAX_SOURCE_BYTES ? text : "";
  } catch {
    return "";
  }
}

function extractFinalizerModel(source, baseHref) {
  const fullMenu = extractElementById(source, "menu-full", "ul");
  if (!fullMenu) return null;

  const blogChunk = extractLiByClass(fullMenu, "menu-blog");
  const destinationsChunk = extractLiByClass(fullMenu, "menu-destinations");
  const blog = extractBlogCardsExact(blogChunk, baseHref).slice(0, 4);

  const blogButtonChunk = extractElementByClass(blogChunk, "submenu-blog-btn", "div");
  const blogSeeAll = extractFirstLink(blogButtonChunk, baseHref)
    || { label: "see all", href: resolvePublicUrl("/blog/", baseHref) || "#" };

  const destinationTopLink = extractFirstLink(destinationsChunk, baseHref)
    || { label: "Destinations", href: resolvePublicUrl("/destinations/", baseHref) || "#" };

  const mapMatch = source.match(/url\(\s*(['"]?)([^)'\"]*destinations-map-submenu\.svg[^)'\"]*)\1\s*\)/i);
  const mapImage = resolvePublicUrl(mapMatch?.[2] || "", baseHref)
    || resolvePublicUrl("/files/themes/kobuxdomitur/dist/images/destinations-map-submenu.svg", baseHref)
    || "";

  const cssBlock = source.match(/#full-menu\s+\.full-menu>li\.has-submenu\.has-custom-submenu-destinations\s+\.sub-menu\{([^}]*)\}/i)?.[1] || "";
  const geometry = {
    backgroundPosition: safeCssPair(cssValue(cssBlock, "background-position"), "4.1vw -6vw"),
    backgroundSize: safeBackgroundSize(cssValue(cssBlock, "background-size"), "auto 66.3vw"),
    minHeight: safeCssLength(cssValue(cssBlock, "min-height"), "734px"),
    right: safeCssLength(cssValue(cssBlock, "right"), "-8.15vw"),
    translateY: safeTranslateY(cssValue(cssBlock, "transform"), "-150px"),
  };

  return {
    blog,
    blogSeeAll,
    destinations: {
      label: cleanText(destinationTopLink.label) || "Destinations",
      href: destinationTopLink.href,
      mapImage,
      geometry,
    },
  };
}

function extractBlogCardsExact(chunk, baseHref) {
  const out = [];
  if (!chunk) return out;
  const re = /<li\b[^>]*class=["'][^"']*\barticle-card\b[^"']*["'][^>]*>/gi;
  let match;
  while ((match = re.exec(chunk)) && out.length < 6) {
    const card = extractBalancedTag(chunk, match.index, "li");
    if (!card) continue;
    const a = card.match(/<a\b([^>]*)>/i);
    const href = a ? resolvePublicUrl(attr(a[1], "href"), baseHref) : null;
    const title = cleanText(card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3\s*>/i)?.[1] || "");
    const date = extractExactClassText(card, "post-date");
    const category = extractExactClassText(card, "categories");
    if (href && title) out.push({ href, title, date, category });
    re.lastIndex = Math.max(re.lastIndex, match.index + card.length);
  }
  return dedupeBy(out, (x) => x.href);
}

function extractExactClassText(source, className) {
  const re = /<div\b([^>]*)>/gi;
  let match;
  while ((match = re.exec(source))) {
    const classes = attr(match[1], "class").split(/\s+/).filter(Boolean);
    if (!classes.includes(className)) continue;
    const block = extractBalancedTag(source, match.index, "div");
    if (!block) continue;
    return cleanText(block.replace(/^<div\b[^>]*>/i, "").replace(/<\/div\s*>$/i, ""));
  }
  return "";
}

function finalizeBlogMetadata(html, blog) {
  let index = 0;
  let count = 0;
  const next = String(html || "").replace(
    /(<span\b[^>]*class=["'][^"']*\bmenu-blog-meta\b[^"']*["'][^>]*>)([\s\S]*?)(<\/span\s*>)/gi,
    (all, open, oldValue, close) => {
      const item = blog[index++];
      if (!item) return all;
      count += 1;
      return `${open}${esc([item.date, item.category].filter(Boolean).join(" · "))}${close}`;
    }
  );
  return { html: next, count };
}

function finalizeBlogSeeAll(html, item) {
  if (!item?.href) return { html: String(html || ""), applied: false };
  if (String(html || "").includes("menu-blog-see-all-wrap")) return { html: String(html || ""), applied: true };

  const source = String(html || "");
  const rowMatch = /<div\b[^>]*data-menu-row=["']blog["'][^>]*>/i.exec(source);
  if (!rowMatch) return { html: source, applied: false };
  const row = extractBalancedTag(source, rowMatch.index, "div");
  if (!row) return { html: source, applied: false };

  const rowClose = row.lastIndexOf("</div>");
  if (rowClose < 0) return { html: source, applied: false };
  const beforeRowClose = row.slice(0, rowClose);
  const panelClose = beforeRowClose.lastIndexOf("</div>");
  if (panelClose < 0) return { html: source, applied: false };

  const cta = `<div class="menu-blog-see-all-wrap"><a class="pill menu-blog-see-all" href="${escAttr(item.href)}">${esc(item.label || "see all")}</a></div>`;
  const nextRow = row.slice(0, panelClose) + cta + row.slice(panelClose);
  return {
    html: source.slice(0, rowMatch.index) + nextRow + source.slice(rowMatch.index + row.length),
    applied: true,
  };
}

function finalizeDestinations(html, destinations) {
  if (!destinations?.href) return { html: String(html || ""), applied: false };
  const source = String(html || "");
  const rowMatch = /<div\b[^>]*data-menu-row=["']destinations["'][^>]*>/i.exec(source);
  if (!rowMatch) return { html: source, applied: false };
  const row = extractBalancedTag(source, rowMatch.index, "div");
  if (!row) return { html: source, applied: false };

  let nextRow = row.replace(
    /<span\b[^>]*class=["'][^"']*\bmenu-main-label\b[^"']*["'][^>]*>\s*Destinations\s*<\/span\s*>/i,
    `<a class="menu-main-link menu-main-destinations-link" href="${escAttr(destinations.href)}">${esc(destinations.label || "Destinations")}</a>`
  );

  if (destinations.mapImage) {
    nextRow = nextRow.replace(
      /(--menu-map:url\(')([^']*)('\))/i,
      `$1${escCssUrl(destinations.mapImage)}$3`
    );
  }

  nextRow = nextRow.replace(
    /<div\b([^>]*)class=["']([^"']*\bmenu-destinations-panel\b[^"']*)["']([^>]*)>/i,
    (all, before, classes, after) => {
      if (/data-menu-destinations-finalized=/i.test(all)) return all;
      return `<div${before}class="${classes}"${after} data-menu-destinations-finalized="true">`;
    }
  );

  return {
    html: source.slice(0, rowMatch.index) + nextRow + source.slice(rowMatch.index + row.length),
    applied: /menu-main-destinations-link/.test(nextRow) && /data-menu-destinations-finalized="true"/.test(nextRow),
  };
}

function stampV232(html) {
  return String(html || "").replace(/<html\b([^>]*)>/i, (all, attrs) => {
    let next = String(attrs || "").replace(/\sdata-menu-engine=(['"])[^'"]*\1/i, "");
    return `<html${next} data-menu-engine="v2.3.2">`;
  });
}

function injectFinalizerCss(html, geometry = null) {
  if (html.includes("pfr-v232-menu-finalizer-css")) return html;
  const g = geometry || {
    backgroundPosition: "4.1vw -6vw",
    backgroundSize: "auto 66.3vw",
    minHeight: "734px",
    right: "-8.15vw",
    translateY: "-150px",
  };
  const css = `<style id="pfr-v232-menu-finalizer-css">
/* V2.3.2 — generated menu fidelity finalizer. */
html[data-menu-engine="v2.3.2"] [data-menu-row="destinations"] .menu-subpanel{grid-column:4/-1;overflow:visible}
html[data-menu-engine="v2.3.2"] .menu-destinations-panel{height:100vh;max-height:100vh;min-height:${escCssValue(g.minHeight)};right:${escCssValue(g.right)};transform:translateY(${escCssValue(g.translateY)});background-position:${escCssValue(g.backgroundPosition)};background-size:${escCssValue(g.backgroundSize)};position:relative}
html[data-menu-engine="v2.3.2"] .menu-main-destinations-link{display:block}
html[data-menu-engine="v2.3.2"] .menu-blog-see-all-wrap{display:flex;justify-content:center;margin-top:30px}
html[data-menu-engine="v2.3.2"] .menu-blog-see-all{font-size:16px;line-height:19px}
@media(max-width:1200px) and (min-width:993px){html[data-menu-engine="v2.3.2"] [data-menu-row="destinations"] .menu-subpanel{grid-column:6/-1!important}html[data-menu-engine="v2.3.2"] .menu-destinations-panel{right:0}}
@media(max-width:992px){html[data-menu-engine="v2.3.2"] [data-menu-row="destinations"] .menu-subpanel{grid-column:auto!important;overflow:hidden}html[data-menu-engine="v2.3.2"] .menu-destinations-panel{height:auto;max-height:none;min-height:420px;right:auto;transform:none;background-position:center;background-size:contain}}
@media(max-width:600px){html[data-menu-engine="v2.3.2"] .menu-destinations-panel{min-height:320px}html[data-menu-engine="v2.3.2"] .menu-blog-see-all{font-size:14px}}
</style>`;
  return String(html || "").replace(/<\/head>/i, `${css}</head>`);
}

function extractFirstLink(chunk, baseHref) {
  if (!chunk) return null;
  const match = chunk.match(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/i);
  if (!match) return null;
  const href = resolvePublicUrl(attr(match[1], "href"), baseHref);
  const label = cleanText(match[2]);
  return href && label ? { href, label } : null;
}

function extractElementById(source, id, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*id=["']${escapeRegex(id)}["'][^>]*>`, "i");
  const match = re.exec(source);
  return match ? extractBalancedTag(source, match.index, tag) : "";
}

function extractElementByClass(source, className, tag) {
  if (!source) return "";
  const re = new RegExp(`<${tag}\\b[^>]*class=["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["'][^>]*>`, "i");
  const match = re.exec(source);
  return match ? extractBalancedTag(source, match.index, tag) : "";
}

function extractLiByClass(source, className) {
  if (!source) return "";
  const re = new RegExp(`<li\\b[^>]*class=["'][^"']*\\b${escapeRegex(className)}\\b[^"']*["'][^>]*>`, "i");
  const match = re.exec(source);
  return match ? extractBalancedTag(source, match.index, "li") : "";
}

function extractBalancedTag(source, startIndex, tagName) {
  const tag = escapeRegex(tagName);
  const re = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  re.lastIndex = startIndex;
  let depth = 0;
  let started = false;
  let match;
  while ((match = re.exec(source))) {
    const token = match[0];
    const closing = new RegExp(`^<\\/${tag}`, "i").test(token);
    const selfClosing = /\/\s*>$/.test(token);
    if (!closing) {
      depth += 1;
      started = true;
      if (selfClosing) depth -= 1;
    } else if (started) depth -= 1;
    if (started && depth === 0) return source.slice(startIndex, re.lastIndex);
  }
  return "";
}

function cssValue(block, property) {
  const match = String(block || "").match(new RegExp(`(?:^|;)\\s*${escapeRegex(property)}\\s*:\\s*([^;}]*)`, "i"));
  return match?.[1]?.trim() || "";
}

function safeCssPair(value, fallback) {
  return /^-?\d+(?:\.\d+)?(?:px|vw|vh|%)\s+-?\d+(?:\.\d+)?(?:px|vw|vh|%)$/i.test(String(value || "").trim())
    ? String(value).trim()
    : fallback;
}

function safeBackgroundSize(value, fallback) {
  return /^(?:auto|-?\d+(?:\.\d+)?(?:px|vw|vh|%))\s+(?:auto|-?\d+(?:\.\d+)?(?:px|vw|vh|%))$/i.test(String(value || "").trim())
    ? String(value).trim()
    : fallback;
}

function safeCssLength(value, fallback) {
  return /^-?\d+(?:\.\d+)?(?:px|vw|vh|%)$/i.test(String(value || "").trim())
    ? String(value).trim()
    : fallback;
}

function safeTranslateY(value, fallback) {
  const match = String(value || "").match(/translateY\(\s*(-?\d+(?:\.\d+)?(?:px|vw|vh|%))\s*\)/i);
  return match?.[1] || fallback;
}

function escCssValue(value) {
  const text = String(value || "");
  return /^[a-z0-9.%+\-\s]+$/i.test(text) ? text : "0";
}

function cleanText(value) {
  return decodeEntities(
    String(value || "")
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function attr(attrs, name) {
  return String(attrs || "").match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2]
    || String(attrs || "").match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i"))?.[1]
    || "";
}

function resolvePublicUrl(value, baseHref) {
  if (!value || /^data:|^javascript:/i.test(value)) return null;
  try {
    const url = new URL(value, baseHref);
    return ["http:", "https:"].includes(url.protocol) && isSafePublicUrl(url) ? url.href : null;
  } catch {
    return null;
  }
}

function isSafePublicUrl(url) {
  if (!(url instanceof URL) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return false;
  if (host === "::1" || host === "::" || /^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return false;
  return true;
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function esc(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;"); }
function escAttr(value) { return esc(value); }
function escCssUrl(value) { return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\)/g, "\\)"); }
function byteLength(value) { return new TextEncoder().encode(String(value || "")).length; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS }); }
