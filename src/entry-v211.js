import app from "./entry-v21.js";

const MAX_SOURCE_BYTES = 2_500_000;
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
        buildWebMode: "v2.1.1-structural-fidelity + v2.1-block-aware + v2.0-legacy + v1-static-snapshot",
        cleanReconstructionEngine: true,
        blockAwareReconstruction: true,
        structuralFidelityPass: true,
        headerLogoRecovery: true,
        primaryNavigationRecovery: true,
        encountersComponentRecovery: true,
        membershipBoundaryGuard: true,
        fontTokenRecovery: true,
        contentScopeIsolation: true,
        heroStructureRecovery: true,
        journeysStructureRecovery: true,
        membershipsRecovery: true,
        destinationMapRecovery: true,
        brandTokenRecovery: true,
        cleanReconstructionUsesTargetScripts: false,
        cleanReconstructionUsesTargetCssAsLayout: false,
        cleanReconstructionBrowserQuotaUsed: false,
        structuralSourceRefetch: true,
        v21BaseEngine: "2.1.0",
        v2LegacyEngine: "2.0.2",
        v1CompatibilityEngine: "1.6.3",
        version: "2.1.1",
      });
    }

    if (url.pathname === "/api/build-v2" && request.method === "POST") {
      return handleBuildV211(request, env, ctx);
    }

    return app.fetch(request, env, ctx);
  },
};

async function handleBuildV211(request, env, ctx) {
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

  let sourceHtml = "";
  let sourceRefetchUsed = false;
  try {
    const finalUrl = new URL(payload.finalUrl || payload.target);
    if (isSafePublicUrl(finalUrl)) {
      const sourceResponse = await fetch(finalUrl.href, {
        method: "GET",
        redirect: "manual",
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "user-agent": "Passive-Fetch-Render-Auditor/2.1.1 Structural-Fidelity",
          dnt: "1",
        },
        signal: AbortSignal.timeout(15_000),
      });
      const sourceType = sourceResponse.headers.get("content-type") || "";
      if (sourceResponse.ok && /html|xhtml/i.test(sourceType)) {
        const text = await sourceResponse.text();
        if (byteLength(text) <= MAX_SOURCE_BYTES) {
          sourceHtml = text;
          sourceRefetchUsed = true;
        }
      }
    }
  } catch {
    sourceHtml = "";
  }

  const polished = sourceHtml
    ? polishStructuralFidelity(payload.html, sourceHtml, payload.finalUrl || payload.target)
    : { html: payload.html, stats: emptyStats() };

  const html = polished.html
    .replace(/Block-Aware Clean Reconstruction V2\.1/g, "Structural Fidelity Reconstruction V2.1.1")
    .replace(/Block-aware clean reconstruction from public page content\./g, "Structural-fidelity clean reconstruction from public page content.");

  return json({
    ...payload,
    engine: "v2.1.1-structural-fidelity-reconstruction",
    mode: "clean-reconstruction-v211",
    filename: String(payload.filename || "clean-v21.html").replace(/-clean-v21\.html$/i, "-clean-v211.html"),
    html,
    htmlBytes: byteLength(html),
    stats: {
      ...(payload.stats || {}),
      structuralSourceRefetchUsed: sourceRefetchUsed,
      structuralFidelityApplied: Object.values(polished.stats).some(Boolean),
      headerLogoRecovered: polished.stats.logoRecovered,
      primaryNavigationRecovered: polished.stats.navigationRecovered,
      encountersRecovered: polished.stats.encountersRecovered,
      encounterItemsRecovered: polished.stats.encounterItems,
      membershipBoundaryRecovered: polished.stats.membershipBoundaryRecovered,
      membershipAssetsRecovered: polished.stats.membershipAssets,
      fontTokensRecovered: polished.stats.fontTokensRecovered,
    },
    model: {
      ...(payload.model || {}),
      structuralFidelity: {
        headerLogo: polished.stats.logoRecovered,
        primaryNavigation: polished.stats.navigationRecovered,
        encounters: polished.stats.encounterItems,
        memberships: polished.stats.membershipAssets,
        fontTokens: polished.stats.fontTokensRecovered,
      },
    },
    safety: {
      ...(payload.safety || {}),
      targetScriptsCopied: false,
      targetJavaScriptExecutedByBuild: false,
      targetCssUsedAsLayoutFoundation: false,
      structuralPassUsesPublicMarkupOnly: true,
      structuralPassGeneratedInteractionsOnly: true,
    },
  }, baseResponse.status);
}

function polishStructuralFidelity(inputHtml, sourceHtml, baseHref) {
  let html = String(inputHtml || "");
  const source = String(sourceHtml || "");
  const stats = emptyStats();

  const logo = extractHeaderLogoSvg(source);
  if (logo) {
    const next = html.replace(/<a class="brand" href="#top">[\s\S]*?<\/a>/i, `<a class="brand" href="#top">${logo}</a>`);
    if (next !== html) {
      html = next;
      stats.logoRecovered = true;
    }
  }

  const nav = extractPrimaryNavigation(source, baseHref);
  if (nav.length >= 3) {
    const navHtml = nav.map((item) => `<a href="${escAttr(item.href)}">${esc(item.label)}</a>`).join("");
    const next = html.replace(/<nav class="menu-grid">[\s\S]*?<\/nav>/i, `<nav class="menu-grid">${navHtml}</nav>`);
    if (next !== html) {
      html = next;
      stats.navigationRecovered = true;
    }
  }

  const fontTokens = extractFontTokens(source);
  const fontNeedle = /--serif:Georgia,"Times New Roman",serif;--sans:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif/;
  if (fontNeedle.test(html)) {
    html = html.replace(fontNeedle, `--serif:${fontTokens.serif};--sans:${fontTokens.sans}`);
    stats.fontTokensRecovered = true;
  }

  const memberships = extractMembershipAssets(source, baseHref);
  if (memberships.length) {
    const membershipSection = `<section class="section reveal memberships-section"><div class="section-inner"><h2>Memberships</h2><div class="partners">${memberships.map((url) => `<div class="partner"><img loading="lazy" src="${escAttr(url)}" alt=""></div>`).join("")}</div></div></section>`;
    const next = replaceSectionByHeading(html, "Memberships", membershipSection);
    if (next !== html) {
      html = next;
      stats.membershipBoundaryRecovered = true;
      stats.membershipAssets = memberships.length;
    }
  }

  const encounters = extractEncounterItems(source, baseHref);
  if (encounters.length >= 2) {
    const encounterSection = renderEncounterSection(encounters);
    const next = replaceSectionByHeading(html, "Unforgettable Encounters", encounterSection);
    if (next !== html) {
      html = next;
      stats.encountersRecovered = true;
      stats.encounterItems = encounters.length;
      html = injectEncounterCss(html);
      html = injectEncounterScript(html, encounters);
    }
  }

  return { html, stats };
}

function extractHeaderLogoSvg(source) {
  const match = source.match(/<div\b[^>]*class=["'][^"']*\blogo-wrapper\b[^"']*["'][^>]*>[\s\S]{0,18000}?<svg\b[\s\S]{0,14000}?<\/svg\s*>/i);
  if (!match) return null;
  const svg = match[0].match(/<svg\b[\s\S]{0,14000}?<\/svg\s*>/i)?.[0];
  return svg ? sanitizeSvg(svg) : null;
}

function extractPrimaryNavigation(source, baseHref) {
  const items = [];
  if (/class=["'][^"']*\bmenu-journeys\b[^"']*["']/i.test(source)) {
    items.push({ label: "Journeys", href: "#journeys" });
  }

  const specs = [
    { slug: "destinations", label: "Destinations" },
    { slug: "about", label: "About" },
    { slug: "blog", label: "Blog" },
    { slug: "contact", label: "Contact" },
  ];
  for (const spec of specs) {
    const re = new RegExp(`<li\\b[^>]*class=["'][^"']*\\bmenu-${spec.slug}\\b[^"']*["'][^>]*>[\\s\\S]{0,4500}?<a\\b([^>]*)>([\\s\\S]*?)<\\/a\\s*>`, "i");
    const match = source.match(re);
    if (!match) continue;
    const href = resolvePublicUrl(attr(match[1], "href"), baseHref);
    if (!href) continue;
    if (!items.some((item) => item.href === href)) items.push({ label: spec.label, href });
  }
  return items.slice(0, 6);
}

function extractFontTokens(source) {
  const serif = cleanFontStack(source.match(/--wp--preset--font-family--vera-humana-95\s*:\s*([^;]+);/i)?.[1])
    || '"Vera Humana 95", Helvetica, Tahoma, sans-serif';
  const sans = cleanFontStack(source.match(/--wp--preset--font-family--gotham\s*:\s*([^;]+);/i)?.[1])
    || '"Gotham", Helvetica, Tahoma, sans-serif';
  return { serif, sans };
}

function cleanFontStack(value) {
  const text = String(value || "").trim();
  if (!text || /[{}<>;]|url\s*\(|expression\s*\(/i.test(text)) return "";
  return text.slice(0, 220);
}

function extractMembershipAssets(source, baseHref) {
  const startMatch = /<div\b[^>]*class=["'][^"']*\bmemberships-slider\b[^"']*["'][^>]*>/i.exec(source);
  if (!startMatch) return [];
  const chunk = source.slice(startMatch.index, startMatch.index + 28_000);
  const images = [];
  const re = /<img\b([^>]*)>/gi;
  let match;
  while ((match = re.exec(chunk)) && images.length < 20) {
    const src = resolvePublicUrl(attr(match[1], "src") || attr(match[1], "data-src"), baseHref);
    if (!src || /map|favicon|icon|loader|spinner|complaint|livro|pixel|tracking/i.test(src)) continue;
    if (!images.includes(src)) images.push(src);
  }
  return images;
}

function extractEncounterItems(source, baseHref) {
  const startMatch = /<div\b[^>]*class=["'][^"']*\bunforgettable-encounters-block\b[^"']*["'][^>]*>/i.exec(source);
  if (!startMatch) return [];
  const chunk = source.slice(startMatch.index, startMatch.index + 38_000);

  const imageByIndex = new Map();
  const imageRe = /<img\b([^>]*)>/gi;
  let imageMatch;
  while ((imageMatch = imageRe.exec(chunk))) {
    const index = attr(imageMatch[1], "data-img-index");
    const src = resolvePublicUrl(attr(imageMatch[1], "src") || attr(imageMatch[1], "data-src"), baseHref);
    if (index !== "" && src && !imageByIndex.has(String(index))) imageByIndex.set(String(index), src);
  }

  const items = [];
  const itemRe = /<button\b([^>]*class=["'][^"']*\bnav-item\b[^"']*["'][^>]*)>([\s\S]*?)<\/button\s*>/gi;
  let match;
  while ((match = itemRe.exec(chunk)) && items.length < 10) {
    const rawIndex = attr(match[1], "data-img-index");
    const index = Number.isFinite(Number(rawIndex)) ? Number(rawIndex) : items.length;
    const label = cleanText(match[2]).slice(0, 80);
    const excerpt = decodeEntities(attr(match[1], "data-excerpt")).replace(/\s+/g, " ").trim().slice(0, 650);
    const href = resolvePublicUrl(attr(match[1], "data-url"), baseHref);
    const image = imageByIndex.get(String(rawIndex)) || null;
    if (!label) continue;
    items.push({ index, label, excerpt, href, image });
  }
  return items;
}

function renderEncounterSection(items) {
  const first = items[0] || {};
  const tabs = items.map((item, index) => `<button class="encounter-tab${index === 0 ? " active" : ""}" type="button" data-encounter-index="${index}" aria-selected="${index === 0 ? "true" : "false"}">${esc(item.label)}</button>`).join("");
  const images = items.map((item, index) => item.image ? `<img class="encounter-image${index === 0 ? " active" : ""}" data-encounter-image="${index}" src="${escAttr(item.image)}" alt="${escAttr(item.label)}">` : "").join("");
  return `<section class="section encounters-section reveal" data-encounters><div class="section-inner"><h2>Unforgettable Encounters</h2><div class="encounters-layout"><div class="encounter-tabs" role="tablist" aria-label="Encounters">${tabs}</div><div class="encounter-stage">${images}<button class="encounter-arrow prev" type="button" aria-label="Previous encounter">←</button><button class="encounter-arrow next" type="button" aria-label="Next encounter">→</button></div><div class="encounter-detail"><p class="encounter-excerpt">${esc(first.excerpt || "")}</p>${first.href ? `<a class="pill encounter-link" href="${escAttr(first.href)}">learn more</a>` : `<a class="pill encounter-link" href="#" hidden>learn more</a>`}</div></div></div></section>`;
}

function injectEncounterCss(html) {
  if (html.includes("pfr-v211-encounters-css")) return html;
  const css = `<style id="pfr-v211-encounters-css">
.encounters-section{background:#fff}.encounters-layout{display:grid;grid-template-columns:minmax(220px,.62fr) minmax(0,1.38fr);gap:clamp(28px,5vw,72px);align-items:start}.encounter-tabs{display:flex;flex-direction:column;gap:4px}.encounter-tab{border:0;background:transparent;color:var(--ink);text-align:left;padding:10px 0;font-family:var(--serif);font-size:clamp(1.5rem,2.4vw,2.625rem);line-height:1.05;cursor:pointer;opacity:.42;transition:opacity .24s ease,transform .24s ease}.encounter-tab:hover{opacity:.72}.encounter-tab.active{opacity:1;transform:translateX(8px)}.encounter-stage{position:relative;min-height:520px;border-radius:var(--radius);overflow:hidden;background:var(--surface)}.encounter-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transform:scale(1.015);transition:opacity .4s ease,transform .6s cubic-bezier(.2,.65,.25,1)}.encounter-image.active{opacity:1;transform:none}.encounter-arrow{position:absolute;z-index:2;top:50%;transform:translateY(-50%);width:52px;height:48px;border:0;border-radius:28px;background:var(--surface);color:var(--ink);cursor:pointer}.encounter-arrow.prev{left:14px}.encounter-arrow.next{right:14px}.encounter-detail{grid-column:1/2;margin-top:-160px;padding-right:20px}.encounter-excerpt{min-height:120px}.memberships-section .partners{margin-top:20px}@media(max-width:900px){.encounters-layout{grid-template-columns:1fr}.encounter-tabs{order:2;flex-direction:row;overflow:auto;gap:18px;padding-bottom:6px}.encounter-tab{white-space:nowrap;font-size:1.35rem}.encounter-tab.active{transform:none}.encounter-stage{order:1;min-height:62vw}.encounter-detail{order:3;grid-column:auto;margin-top:0;padding-right:0}}@media(prefers-reduced-motion:reduce){.encounter-tab,.encounter-image{transition:none}}
</style>`;
  return html.replace(/<\/head>/i, `${css}</head>`);
}

function injectEncounterScript(html, items) {
  if (html.includes("pfr-v211-encounters-script")) return html;
  const data = JSON.stringify(items).replace(/</g, "\\u003c");
  const script = `<script id="pfr-v211-encounters-script">(()=>{const root=document.querySelector('[data-encounters]');if(!root)return;const data=${data};const tabs=[...root.querySelectorAll('[data-encounter-index]')],imgs=[...root.querySelectorAll('[data-encounter-image]')],excerpt=root.querySelector('.encounter-excerpt'),link=root.querySelector('.encounter-link');let index=0;const show=n=>{if(!data.length)return;index=(n+data.length)%data.length;tabs.forEach((button,i)=>{button.classList.toggle('active',i===index);button.setAttribute('aria-selected',String(i===index))});imgs.forEach((image,i)=>image.classList.toggle('active',i===index));if(excerpt)excerpt.textContent=data[index]?.excerpt||'';if(link){if(data[index]?.href){link.href=data[index].href;link.hidden=false}else{link.hidden=true}}};tabs.forEach((button,i)=>button.addEventListener('click',()=>show(i)));root.querySelector('.encounter-arrow.prev')?.addEventListener('click',()=>show(index-1));root.querySelector('.encounter-arrow.next')?.addEventListener('click',()=>show(index+1));show(0)})();</script>`;
  return html.replace(/<\/body>/i, `${script}</body>`);
}

function replaceSectionByHeading(html, heading, replacement) {
  const needle = `<h2>${heading}</h2>`;
  const index = html.indexOf(needle);
  if (index < 0) return html;
  const start = html.lastIndexOf("<section", index);
  const closeIndex = html.indexOf("</section>", index);
  if (start < 0 || closeIndex < 0) return html;
  const end = closeIndex + "</section>".length;
  return html.slice(0, start) + replacement + html.slice(end);
}

function sanitizeSvg(svg) {
  return String(svg || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(["']).*?\1/gi, "")
    .replace(/\s(?:href|xlink:href)\s*=\s*(["'])javascript:[\s\S]*?\1/gi, "");
}

function resolvePublicUrl(value, baseHref) {
  if (!value || /^data:|^javascript:|^mailto:|^tel:/i.test(value)) return null;
  try {
    const url = new URL(decodeEntities(value), baseHref);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function isSafePublicUrl(url) {
  if (!(url instanceof URL) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split(".").map(Number);
    if (parts.some((part) => part < 0 || part > 255)) return false;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return false;
  return true;
}

function attr(attrs, name) {
  return attrs.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2]
    || attrs.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i"))?.[1]
    || "";
}

function cleanText(value) {
  return decodeEntities(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function esc(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escAttr(value) { return esc(value).replace(/`/g, "&#96;"); }
function byteLength(value) { return new TextEncoder().encode(String(value || "")).byteLength; }
function emptyStats() {
  return {
    logoRecovered: false,
    navigationRecovered: false,
    encountersRecovered: false,
    encounterItems: 0,
    membershipBoundaryRecovered: false,
    membershipAssets: 0,
    fontTokensRecovered: false,
  };
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
