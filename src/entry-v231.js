import app from "./entry-v23.js";

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
    if (url.pathname === "/api/build-v2" && request.method === "POST") return handleBuildV231(request, env, ctx);
    return app.fetch(request, env, ctx);
  },
};

async function handleHealth(request, env, ctx) {
  const base = await app.fetch(request, env, ctx);
  const payload = await base.json().catch(() => ({}));
  return json({
    ...payload,
    buildWebMode: "v2.3.1-menu-surface-fidelity + v2.3-visual-fidelity + v2.2.1-geometry-baseline + v2.1.3-structure-baseline + v1-static-snapshot",
    structuralLockBaseline: "2.1.3",
    geometryLockBaseline: "2.2.1",
    visualBaselineCandidate: "2.3.1",
    structuralLockPreserved: true,
    geometryLockPreserved: true,
    visualFidelityEngine: true,
    menuSurfaceFidelityPolish: true,
    nestedMenuRecovery: true,
    journeyMenuCardRecovery: true,
    destinationsMenuPanelRecovery: true,
    aboutSubmenuRecovery: true,
    blogMenuCardRecovery: true,
    secondaryMenuLinkRecovery: true,
    menuSourceRefetch: true,
    generatedMenuCssOnly: true,
    generatedMenuJsOnly: true,
    visualCopiesTargetCss: false,
    cleanReconstructionUsesTargetScripts: false,
    cleanReconstructionUsesTargetCssAsLayout: false,
    cleanReconstructionBrowserQuotaUsed: false,
    v23BaseEngine: "2.3.0",
    v221BaseEngine: "2.2.1",
    v213BaseEngine: "2.1.3",
    version: "2.3.1",
  }, base.status);
}

async function handleBuildV231(request, env, ctx) {
  const started = Date.now();
  const baseResponse = await app.fetch(request, env, ctx);
  const contentType = baseResponse.headers.get("content-type") || "";
  if (!/application\/json/i.test(contentType)) return baseResponse;

  const payload = await baseResponse.json().catch(() => null);
  if (!payload || !baseResponse.ok || !payload.ok || !payload.html) {
    return new Response(payload ? JSON.stringify(payload) : "{}", { status: baseResponse.status, headers: JSON_HEADERS });
  }

  let html = String(payload.html || "");
  const baseHref = payload.finalUrl || payload.target || "";
  const source = await refetchPublicHtml(baseHref);
  const menuModel = source ? extractFullMenuModel(source, baseHref, html) : null;
  const menuResult = menuModel ? replaceFlatMenu(html, menuModel) : { html, applied: false };
  html = menuResult.html;
  html = stampV231(html);
  html = injectMenuCss(html);
  html = injectMenuJs(html);
  html = html
    .replace(/Visual Fidelity Reconstruction V2\.3/g, "Menu & Surface Fidelity Reconstruction V2.3.1")
    .replace(/Structure and geometry-locked reconstruction with generated visual fidelity polish from public page signals\./g, "Structure and geometry-locked reconstruction with generated menu and surface fidelity polish from public page signals.");

  const structureReady = Boolean(payload.stats?.structuralLockReady);
  const geometryReady = Boolean(payload.stats?.geometryLockReady);
  const visualBaseReady = Boolean(payload.stats?.visualFidelityEngineApplied);
  const menuCssApplied = html.includes("pfr-v231-menu-surface-css");
  const menuJsApplied = html.includes("pfr-v231-menu-js");
  const menuReady = Boolean(menuResult.applied && menuCssApplied && menuJsApplied);

  return json({
    ...payload,
    engine: "v2.3.1-menu-surface-fidelity-polish",
    mode: "clean-reconstruction-v231",
    filename: String(payload.filename || "clean-v23.html")
      .replace(/-clean-v23\.html$/i, "-clean-v231.html")
      .replace(/-clean-v221\.html$/i, "-clean-v231.html"),
    html,
    htmlBytes: byteLength(html),
    durationMs: Date.now() - started,
    stats: {
      ...(payload.stats || {}),
      structuralLockReady: structureReady,
      structuralLockPreserved: structureReady,
      geometryLockReady: geometryReady,
      geometryLockPreserved: geometryReady,
      visualFidelityEngineApplied: visualBaseReady,
      menuSourceRefetchUsed: Boolean(source),
      menuModelRecovered: Boolean(menuModel),
      menuSurfaceFidelityPolishApplied: menuReady,
      nestedMenuRecoveryApplied: menuResult.applied,
      journeyMenuCardsRecovered: menuModel?.journeys?.length || 0,
      destinationsMenuPanelRecovered: Boolean(menuModel?.destinations?.href),
      aboutSubmenuLinksRecovered: menuModel?.about?.length || 0,
      blogMenuCardsRecovered: menuModel?.blog?.length || 0,
      secondaryMenuLinksRecovered: menuModel?.secondary?.length || 0,
      menuTopLevelCount: menuModel?.topLevelCount || 0,
      generatedMenuCssApplied: menuCssApplied,
      generatedMenuJsApplied: menuJsApplied,
      targetScriptsCopied: 0,
      targetLayoutCssCopied: 0,
      targetFontFilesCopied: 0,
    },
    model: {
      ...(payload.model || {}),
      menuSurfaceFidelity: menuModel ? {
        version: "2.3.1",
        structuralBaseline: "2.1.3",
        geometryBaseline: "2.2.1",
        visualBase: "2.3.0",
        topLevelCount: menuModel.topLevelCount,
        journeyCards: menuModel.journeys.length,
        destinationsPanel: Boolean(menuModel.destinations.href),
        aboutLinks: menuModel.about.length,
        blogCards: menuModel.blog.length,
        secondaryLinks: menuModel.secondary.length,
        desktopMainLabelPx: 42,
        desktopSubmenuPx: 30,
        mobileMainLabelPx: 30,
        mobileSubmenuPx: 21.4,
        submenuControlPx: 42,
        journeyCardAspect: "190/256",
        generatedCssOnly: true,
        generatedJsOnly: true,
      } : null,
    },
    safety: {
      ...(payload.safety || {}),
      targetScriptsCopied: false,
      targetJavaScriptExecutedByBuild: false,
      targetCssUsedAsLayoutFoundation: false,
      targetCssCopied: false,
      targetFontFilesCopied: false,
      menuRecoveryUsesPublicMarkupOnly: true,
      menuOutputUsesGeneratedCssOnly: true,
      menuInteractionUsesGeneratedJsOnly: true,
      menuRecoverySubmitsTargetForms: false,
      menuRecoveryExecutesTargetJavaScript: false,
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
        "user-agent": "Passive-Fetch-Render-Auditor/2.3.1 Menu-Surface",
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

function extractFullMenuModel(source, baseHref, generatedHtml) {
  const fullMenu = extractElementById(source, "menu-full", "ul");
  if (!fullMenu) return null;

  const journeysChunk = extractLiByClass(fullMenu, "menu-journeys");
  const destinationsChunk = extractLiByClass(fullMenu, "menu-destinations");
  const aboutChunk = extractLiByClass(fullMenu, "menu-about");
  const blogChunk = extractLiByClass(fullMenu, "menu-blog");
  const contactChunk = extractLiByClass(fullMenu, "menu-contact");

  const journeys = extractJourneyCards(journeysChunk, baseHref).slice(0, 6);
  const about = extractSimpleLinks(aboutChunk, baseHref, ["About"]).slice(0, 6);
  const blog = extractBlogCards(blogChunk, baseHref).slice(0, 4);
  const secondaryChunk = extractElementByClass(source, "full-menu-secondary", "ul");
  const secondary = extractSimpleLinks(secondaryChunk, baseHref).slice(0, 4);
  const destinationLinks = extractSimpleLinks(destinationsChunk, baseHref);
  const destinationsHref = destinationLinks.find((item) => /explore map/i.test(item.label))?.href
    || destinationLinks.find((item) => /destination/i.test(item.label))?.href
    || resolvePublicUrl("/destinations/", baseHref)
    || "#";
  const contact = extractSimpleLinks(contactChunk, baseHref)[0] || { label: "Contact", href: resolvePublicUrl("/contact/", baseHref) || "#" };
  const mapImage = generatedHtml.match(/<img\b[^>]*class=["'][^"']*\bmap-bg\b[^"']*["'][^>]*src=["']([^"']+)["']/i)?.[1]
    || resolvePublicUrl("/files/themes/kobuxdomitur/dist/images/destinations-map-submenu.svg", baseHref)
    || "";

  const topLevelCount = [journeysChunk, destinationsChunk, aboutChunk, blogChunk, contactChunk].filter(Boolean).length;
  if (topLevelCount < 4) return null;

  return {
    topLevelCount,
    journeys,
    destinations: { label: "Destinations", href: destinationsHref, mapImage },
    about,
    blog,
    contact,
    secondary,
  };
}

function extractJourneyCards(chunk, baseHref) {
  const out = [];
  if (!chunk) return out;
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = re.exec(chunk)) && out.length < 8) {
    const href = resolvePublicUrl(attr(match[1], "href"), baseHref);
    if (!href) continue;
    const img = match[2].match(/<img\b([^>]*)>/i);
    if (!img) continue;
    const image = resolvePublicUrl(attr(img[1], "src") || firstSrcset(attr(img[1], "srcset")), baseHref);
    const label = cleanText(attr(img[1], "alt")) || cleanText(match[2]);
    if (!image || !label) continue;
    out.push({ label, href, image });
  }
  return dedupeBy(out, (x) => x.href);
}

function extractBlogCards(chunk, baseHref) {
  const out = [];
  if (!chunk) return out;
  const re = /<li\b[^>]*class=["'][^"']*\barticle-card\b[^"']*["'][^>]*>/gi;
  let match;
  while ((match = re.exec(chunk)) && out.length < 6) {
    const card = extractBalancedTag(chunk, match.index, "li");
    if (!card) continue;
    const a = card.match(/<a\b([^>]*)>/i);
    const href = a ? resolvePublicUrl(attr(a[1], "href"), baseHref) : null;
    const img = card.match(/<img\b([^>]*)>/i);
    const image = img ? resolvePublicUrl(attr(img[1], "src") || firstSrcset(attr(img[1], "srcset")), baseHref) : null;
    const title = cleanText(card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3\s*>/i)?.[1] || "");
    const date = cleanText(card.match(/<div\b[^>]*class=["'][^"']*\bpost-date\b[^"']*["'][^>]*>([\s\S]*?)<\/div\s*>/i)?.[1] || "");
    const category = cleanText(card.match(/<div\b[^>]*class=["'][^"']*\bcategories\b[^"']*["'][^>]*>([\s\S]*?)<\/div\s*>/i)?.[1] || "");
    if (href && title) out.push({ href, image, title, date, category });
    re.lastIndex = Math.max(re.lastIndex, match.index + card.length);
  }
  return dedupeBy(out, (x) => x.href);
}

function extractSimpleLinks(chunk, baseHref, excluded = []) {
  const out = [];
  if (!chunk) return out;
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = re.exec(chunk)) && out.length < 20) {
    const href = resolvePublicUrl(attr(match[1], "href"), baseHref);
    const label = cleanText(match[2]);
    if (!href || !label || excluded.some((x) => x.toLowerCase() === label.toLowerCase())) continue;
    out.push({ label, href });
  }
  return dedupeBy(out, (x) => x.href + "|" + x.label);
}

function replaceFlatMenu(html, model) {
  const source = String(html || "");
  const startMatch = /<div\b[^>]*class=["'][^"']*\bmenu-overlay\b[^"']*["'][^>]*id=["']menuOverlay["'][^>]*>/i.exec(source)
    || /<div\b[^>]*id=["']menuOverlay["'][^>]*class=["'][^"']*\bmenu-overlay\b[^"']*["'][^>]*>/i.exec(source);
  if (!startMatch) return { html: source, applied: false };
  const old = extractBalancedTag(source, startMatch.index, "div");
  if (!old) return { html: source, applied: false };
  const next = renderMenu(model);
  return {
    html: source.slice(0, startMatch.index) + next + source.slice(startMatch.index + old.length),
    applied: true,
  };
}

function renderMenu(model) {
  const journeyCards = model.journeys.map((item) => `<a class="menu-journey-card" href="${escAttr(item.href)}"><img loading="lazy" src="${escAttr(item.image)}" alt=""><span>${esc(item.label)}</span></a>`).join("");
  const aboutLinks = model.about.map((item) => `<a class="menu-sub-link" href="${escAttr(item.href)}">${esc(item.label)}</a>`).join("");
  const blogCards = model.blog.map((item) => `<a class="menu-blog-card" href="${escAttr(item.href)}">${item.image ? `<figure><img loading="lazy" src="${escAttr(item.image)}" alt=""></figure>` : ""}<span class="menu-blog-meta">${esc([item.date, item.category].filter(Boolean).join(" · "))}</span><strong>${esc(item.title)}</strong><span class="menu-blog-read">read article</span></a>`).join("");
  const secondary = model.secondary.map((item) => `<a href="${escAttr(item.href)}">${esc(item.label)}</a>`).join("");
  const mapStyle = model.destinations.mapImage ? ` style="--menu-map:url('${escCssUrl(model.destinations.mapImage)}')"` : "";

  return `<div class="menu-overlay menu-overlay-v231" id="menuOverlay" data-menu-fidelity="v2.3.1">
  <nav class="full-fidelity-menu" aria-label="Main menu">
    ${renderMenuRow("journeys", "Journeys", `<div class="menu-journey-grid">${journeyCards}</div>`)}
    ${renderMenuRow("destinations", "Destinations", `<div class="menu-destinations-panel"${mapStyle}><a class="pill" href="${escAttr(model.destinations.href)}">explore map</a></div>`)}
    ${renderMenuRow("about", "About", `<div class="menu-about-links">${aboutLinks}</div>`)}
    ${renderMenuRow("blog", `<a class="menu-main-link" href="${escAttr(resolvePublicUrl("/blog/", model.contact.href) || "#")}">Blog</a>`, `<div class="menu-blog-grid">${blogCards}</div>`, true)}
    <div class="menu-row menu-row-contact"><a class="menu-main-link" href="${escAttr(model.contact.href)}">${esc(model.contact.label || "Contact")}</a></div>
    <div class="menu-secondary">${secondary}</div>
  </nav>
</div>`;
}

function renderMenuRow(key, label, panel, labelIsHtml = false) {
  const labelHtml = labelIsHtml ? label : `<span class="menu-main-label">${esc(label)}</span>`;
  return `<div class="menu-row" data-menu-row="${escAttr(key)}">${labelHtml}<button class="menu-submenu-toggle" type="button" aria-expanded="false" aria-label="Toggle ${escAttr(cleanText(label))}"><span aria-hidden="true">›</span></button><div class="menu-subpanel" data-menu-panel="${escAttr(key)}">${panel}</div></div>`;
}

function stampV231(html) {
  return String(html || "").replace(/<html\b([^>]*)>/i, (all, attrs) => {
    let next = String(attrs || "").replace(/\sdata-menu-engine=(['"])[^'"]*\1/i, "");
    return `<html${next} data-menu-engine="v2.3.1">`;
  });
}

function injectMenuCss(html) {
  if (html.includes("pfr-v231-menu-surface-css")) return html;
  const css = `<style id="pfr-v231-menu-surface-css">
/* V2.3.1 — generated menu + surface fidelity. */
html[data-menu-engine="v2.3.1"] .menu-overlay-v231{background:var(--surface);color:var(--ink);padding:0 var(--geo-side,40px);overflow-y:auto}
html[data-menu-engine="v2.3.1"] .full-fidelity-menu{width:100%;min-height:100%;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));column-gap:var(--geo-gap,2.2vw);align-content:start;padding:150px 0 160px}
html[data-menu-engine="v2.3.1"] .menu-row{grid-column:2/-2;display:grid;grid-template-columns:repeat(10,minmax(0,1fr));column-gap:var(--geo-gap,2.2vw);align-items:start;position:relative;min-height:74px}
html[data-menu-engine="v2.3.1"] .menu-main-label,html[data-menu-engine="v2.3.1"] .menu-main-link{grid-column:1/4;font-family:var(--pfr-serif,var(--serif));font-size:42px;line-height:1.05;font-weight:400;color:var(--ink);padding:0;margin:0;align-self:center}
html[data-menu-engine="v2.3.1"] .menu-submenu-toggle{grid-column:4/5;width:42px;height:42px;border:0;border-radius:50%;background:#fff;color:var(--ink);display:grid;place-items:center;cursor:pointer;transform:translateX(calc(-1 * (var(--geo-gap,2.2vw) + 42px)));z-index:2}
html[data-menu-engine="v2.3.1"] .menu-submenu-toggle span{font-family:Arial,sans-serif;font-size:29px;line-height:1;transform:translateY(-1px);transition:transform .28s ease}
html[data-menu-engine="v2.3.1"] .menu-row.open .menu-submenu-toggle span{transform:rotate(90deg)}
html[data-menu-engine="v2.3.1"] .menu-subpanel{grid-column:5/-1;grid-row:1/span 6;max-height:0;opacity:0;overflow:hidden;pointer-events:none;transition:max-height .45s cubic-bezier(.2,.65,.25,1),opacity .28s ease}
html[data-menu-engine="v2.3.1"] .menu-row.open .menu-subpanel{max-height:1100px;opacity:1;pointer-events:auto;padding-bottom:34px}
html[data-menu-engine="v2.3.1"] .menu-journey-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:var(--geo-gap,2.2vw)}
html[data-menu-engine="v2.3.1"] .menu-journey-card{grid-column:span 2;position:relative;aspect-ratio:190/256;border-radius:34px;overflow:hidden;display:flex;align-items:flex-end;padding:20px;color:#fff;font-family:var(--pfr-serif,var(--serif));font-size:30px;line-height:1.05;isolation:isolate}
html[data-menu-engine="v2.3.1"] .menu-journey-card:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(89,80,79,0),rgba(89,80,79,.48));z-index:-1}
html[data-menu-engine="v2.3.1"] .menu-journey-card img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:0;z-index:-2}
html[data-menu-engine="v2.3.1"] .menu-destinations-panel{min-height:540px;display:flex;align-items:center;justify-content:center;background-image:var(--menu-map);background-repeat:no-repeat;background-position:center;background-size:contain}
html[data-menu-engine="v2.3.1"] .menu-about-links{display:flex;flex-direction:column;gap:30px;padding-top:4px}.menu-about-links .menu-sub-link{font-family:var(--pfr-serif,var(--serif));font-size:30px;line-height:1.05}
html[data-menu-engine="v2.3.1"] .menu-blog-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--geo-gap,2.2vw)}
html[data-menu-engine="v2.3.1"] .menu-blog-card figure{position:relative;margin:0 0 15px;aspect-ratio:1/1;overflow:hidden;border-radius:34px}.menu-blog-card figure img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
html[data-menu-engine="v2.3.1"] .menu-blog-meta{display:block;font-size:14px;line-height:1.15;font-style:italic;margin-bottom:8px}.menu-blog-card strong{display:block;font-family:var(--pfr-serif,var(--serif));font-size:22px;line-height:1.05;font-weight:400;margin-bottom:15px}.menu-blog-read{font-size:16px;text-decoration:underline;text-underline-offset:7px}
html[data-menu-engine="v2.3.1"] .menu-secondary{grid-column:2/-2;display:flex;flex-direction:column;gap:20px;margin-top:60px}.menu-secondary a{font-family:var(--pfr-serif,var(--serif));font-size:18px;line-height:1.1}
html[data-menu-engine="v2.3.1"] .menu-row-contact{min-height:56px}.menu-row-contact .menu-main-link{grid-column:1/4}
@media(max-width:1200px){html[data-menu-engine="v2.3.1"] .menu-row,html[data-menu-engine="v2.3.1"] .menu-secondary{grid-column:1/-1}.menu-main-label,.menu-main-link{grid-column:1/5!important}.menu-submenu-toggle{grid-column:5/6!important}.menu-subpanel{grid-column:6/-1!important}}
@media(max-width:992px){html[data-menu-engine="v2.3.1"] .full-fidelity-menu{display:block;padding-top:114px;padding-bottom:60px}.menu-row{display:flex!important;flex-direction:column;min-height:0!important;padding:0 0 30px}.menu-main-label,.menu-main-link{font-size:42px!important;width:calc(100% - 60px)}.menu-submenu-toggle{position:absolute;right:0;top:0;transform:none!important}.menu-subpanel{width:100%;grid-column:auto!important;padding-top:0}.menu-row.open .menu-subpanel{padding-top:24px}.menu-journey-grid{grid-template-columns:repeat(6,minmax(0,1fr))!important;gap:20px!important}.menu-journey-card{grid-column:span 2!important}.menu-destinations-panel{min-height:420px}.menu-blog-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:20px!important}.menu-secondary{margin-top:30px!important}}
@media(max-width:768px){html[data-menu-engine="v2.3.1"] .menu-overlay-v231{padding-inline:20px}.menu-journey-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important}.menu-journey-card{grid-column:span 2!important;border-radius:30px}.menu-blog-card figure{border-radius:30px}}
@media(max-width:600px){.menu-main-label,.menu-main-link{font-size:30px!important}.menu-about-links .menu-sub-link,.menu-journey-card{font-size:21.4px!important}.menu-secondary a{font-size:18px}.menu-blog-card strong{font-size:16px}.menu-blog-read{font-size:14px}.menu-destinations-panel{min-height:320px}.menu-journey-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.menu-journey-card{grid-column:span 1!important}}
@media(prefers-reduced-motion:reduce){html[data-menu-engine="v2.3.1"] .menu-subpanel,html[data-menu-engine="v2.3.1"] .menu-submenu-toggle span{transition:none!important}}
</style>`;
  return html.replace(/<\/head>/i, `${css}</head>`);
}

function injectMenuJs(html) {
  if (html.includes("pfr-v231-menu-js")) return html;
  const script = `<script id="pfr-v231-menu-js">(()=>{const root=document.querySelector('[data-menu-fidelity="v2.3.1"]');if(!root)return;const rows=[...root.querySelectorAll('[data-menu-row]')];for(const row of rows){const button=row.querySelector('.menu-submenu-toggle');if(!button)continue;button.addEventListener('click',()=>{const opening=!row.classList.contains('open');for(const other of rows){other.classList.remove('open');other.querySelector('.menu-submenu-toggle')?.setAttribute('aria-expanded','false')}if(opening){row.classList.add('open');button.setAttribute('aria-expanded','true')}})}const menuToggle=document.querySelector('#menuToggle');menuToggle?.addEventListener('click',()=>{if(!root.classList.contains('open'))for(const row of rows){row.classList.remove('open');row.querySelector('.menu-submenu-toggle')?.setAttribute('aria-expanded','false')}})})();</script>`;
  return html.replace(/<\/body>/i, `${script}</body>`);
}

function extractElementById(source, id, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*\\bid=["']${escapeRegex(id)}["'][^>]*>`, "i");
  const match = re.exec(source);
  return match ? extractBalancedTag(source, match.index, tag) : "";
}

function extractElementByClass(source, className, tag) {
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

function cleanText(value) {
  return decodeEntities(String(value || "").replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ").replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function attr(attrs, name) {
  return String(attrs || "").match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2]
    || String(attrs || "").match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i"))?.[1]
    || "";
}

function firstSrcset(value) {
  return String(value || "").split(",")[0]?.trim().split(/\s+/)[0] || "";
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
