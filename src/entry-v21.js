import legacy from "./entry-v202.js";

const MAX_HTML_BYTES = 2_500_000;
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
        buildWebV1Configured: true,
        buildWebV2Configured: true,
        buildWebMode: "v2.1-block-aware-clean-reconstruction + v2.0-legacy + v1-static-snapshot",
        cleanReconstructionEngine: true,
        blockAwareReconstruction: true,
        contentScopeIsolation: true,
        heroStructureRecovery: true,
        journeysStructureRecovery: true,
        membershipsRecovery: true,
        destinationMapRecovery: true,
        brandTokenRecovery: true,
        cleanReconstructionUsesTargetScripts: false,
        cleanReconstructionUsesTargetCssAsLayout: false,
        cleanReconstructionBrowserQuotaUsed: false,
        v2LegacyEngine: "2.0.2",
        v1CompatibilityEngine: "1.6.3",
        version: "2.1.0",
      });
    }

    if (url.pathname === "/api/build-v2" && request.method === "POST") {
      return handleBuildV21(request, env);
    }

    return legacy.fetch(request, env, ctx);
  },
};

async function handleBuildV21(request, env) {
  const authError = authorize(request, env);
  if (authError) return authError;

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Body must be valid JSON", code: "INVALID_JSON" }, 400);
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
      return json({ error: `Target returned HTTP ${response.status}`, code: "BUILD_TARGET_HTTP_ERROR" }, 502);
    }
    if (!/html|xhtml/i.test(contentType)) {
      return json({ error: `Build Web V2.1 requires HTML. Received ${contentType || "unknown content type"}.`, code: "BUILD_NOT_HTML" }, 415);
    }

    const rawHtml = await response.text();
    if (byteLength(rawHtml) > MAX_HTML_BYTES) {
      return json({ error: "Source HTML is too large for V2.1 reconstruction.", code: "BUILD_TOO_LARGE" }, 413);
    }

    const model = extractPageModelV21(rawHtml, fetched.finalUrl);
    const built = renderV21(model);

    return json({
      ok: true,
      target: target.href,
      finalUrl: fetched.finalUrl.href,
      builtAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      engine: "v2.1-block-aware-clean-reconstruction",
      mode: "clean-reconstruction-v21",
      source: "scoped-public-content-model",
      browserQuotaUsed: false,
      filename: `${safeFilename(model.siteName || model.title || fetched.finalUrl.hostname)}-clean-v21.html`,
      title: model.title || model.siteName || "Clean reconstruction",
      htmlBytes: byteLength(built),
      html: built,
      stats: {
        contentScope: model.scope,
        blocksDetected: model.sections.length,
        sectionsDetected: model.sections.length,
        testimonialsDetected: model.testimonials.length,
        membershipsDetected: model.memberships.length,
        journeysDetected: model.journeys.length,
        imagesSelected: model.imagesSelected.length,
        targetScriptsCopied: 0,
        targetStylesheetsCopied: 0,
        generatedInteractions: 4,
      },
      model: {
        siteName: model.siteName,
        heroHeading: model.hero.heading,
        sectionHeadings: model.sections.map((section) => section.heading).filter(Boolean),
        palette: model.palette,
        scope: model.scope,
      },
      safety: {
        targetScriptsCopied: false,
        targetJavaScriptExecutedByBuild: false,
        targetCssUsedAsLayoutFoundation: false,
        formsGenerated: false,
        framesGenerated: false,
        networkConnectDisabled: true,
        onlyGeneratedInteractionScriptIncluded: true,
        publicRemoteAssetsMayRemain: true,
      },
    });
  } catch (error) {
    return json({ error: cleanError(error), code: "BUILD_V21_FAILED", durationMs: Date.now() - startedAt }, 502);
  }
}

function extractPageModelV21(rawHtml, baseUrl) {
  const html = String(rawHtml || "");
  const scoped = extractContentScope(html);
  const title = cleanText(firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i));
  const description = cleanText(
    firstMatch(html, /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    firstMatch(html, /<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
  );
  const siteName = cleanText(
    firstMatch(html, /<meta\b[^>]*property=["']og:site_name["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    title.split(/[|–—-]/)[0] || baseUrl.hostname
  ).slice(0, 80);

  const palette = detectBrandPalette(html);
  const brand = extractBrand(html, scoped.start, baseUrl, siteName);
  const hero = extractHero(scoped.html, html, baseUrl, title, description);
  const journeys = extractJourneys(scoped.html, html, baseUrl);
  const testimonials = extractTestimonials(scoped.html).slice(0, 8);
  let sections = extractSectionsBlockAware(scoped.html, baseUrl, hero.heading, testimonials);
  sections = mergeReadyExplore(sections).slice(0, 12);
  const memberships = sections.find((section) => section.kind === "partners")?.images || [];

  const imagesSelected = unique([
    hero.image,
    ...sections.flatMap((section) => section.images || []),
    ...journeys.map((item) => item.image),
    ...memberships,
  ].filter(Boolean)).slice(0, 60);

  return {
    title,
    description,
    siteName: siteName || baseUrl.hostname,
    scope: scoped.scope,
    palette,
    brand,
    hero,
    journeys,
    testimonials,
    memberships,
    sections,
    imagesSelected,
  };
}

function extractContentScope(html) {
  const articleOpen = /<article\b[^>]*\bid=["']content["'][^>]*>/i.exec(html);
  if (articleOpen) {
    const start = articleOpen.index + articleOpen[0].length;
    const end = html.indexOf("</article>", start);
    if (end > start) return { html: html.slice(start, end), start, scope: "article#content" };
  }

  const mainOpen = /<main\b[^>]*>/i.exec(html);
  if (mainOpen) {
    const start = mainOpen.index + mainOpen[0].length;
    const end = html.indexOf("</main>", start);
    if (end > start) return { html: html.slice(start, end), start, scope: "main" };
  }

  const bodyOpen = /<body\b[^>]*>/i.exec(html);
  if (bodyOpen) {
    const start = bodyOpen.index + bodyOpen[0].length;
    const end = html.lastIndexOf("</body>");
    if (end > start) return { html: html.slice(start, end), start, scope: "body-fallback" };
  }
  return { html, start: 0, scope: "document-fallback" };
}

function extractBrand(html, contentStart, baseUrl, siteName) {
  const headArea = html.slice(0, Math.max(0, contentStart));
  const logoIndex = headArea.search(/class=["'][^"']*logo-wrapper[^"']*["']/i);
  if (logoIndex >= 0) {
    const window = headArea.slice(logoIndex, logoIndex + 5000);
    const svg = window.match(/<svg\b[\s\S]{0,10000}?<\/svg\s*>/i)?.[0];
    if (svg) return { type: "svg", markup: sanitizeSvg(svg), text: siteName };
    const img = window.match(/<img\b([^>]*)>/i);
    if (img) {
      const src = resolvePublicAsset(attr(img[1], "src") || attr(img[1], "data-src"), baseUrl);
      if (src) return { type: "image", src, text: siteName };
    }
  }

  const logoImg = html.match(/<img\b([^>]*(?:logo|brand|identity)[^>]*)>/i);
  if (logoImg) {
    const src = resolvePublicAsset(attr(logoImg[1], "src") || attr(logoImg[1], "data-src"), baseUrl);
    if (src && !/complaints|livro|favicon|icon/i.test(src)) return { type: "image", src, text: siteName };
  }
  return { type: "text", text: siteName };
}

function extractHero(content, fullHtml, baseUrl, title, description) {
  const h1 = content.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i);
  const heading = cleanText(h1?.[1] || title || "Welcome").slice(0, 160);
  const h1Index = h1?.index ?? 0;
  const after = content.slice(h1Index, h1Index + 16000);
  const featuredIndex = after.search(/class=["'][^"']*featured-img[^"']*["']/i);
  let image = null;
  if (featuredIndex >= 0) {
    image = extractImageCandidates(after.slice(featuredIndex, featuredIndex + 7000), baseUrl)
      .find((url) => url && !looksLikeUiAsset(url)) || null;
  }
  if (!image) {
    image = resolvePublicAsset(firstMatch(fullHtml, /<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i), baseUrl);
  }

  const between = featuredIndex > 0 ? after.slice(h1?.[0]?.length || 0, featuredIndex) : after.slice(0, 3500);
  const localParagraph = extractParagraphs(between, 1)[0] || "";
  const subheading = localParagraph.length >= 35 ? localParagraph.slice(0, 320) : "";
  return { heading, subheading, image, description };
}

function extractJourneys(content, fullHtml, baseUrl) {
  let chunk = "";
  const start = content.search(/id=["']journeys-floating-menu["']/i);
  if (start >= 0) {
    const tail = content.slice(start);
    const end = tail.search(/class=["'][^"']*featured-img[^"']*["']/i);
    chunk = tail.slice(0, end > 0 ? end : 8000);
  }
  if (!chunk) {
    const menu = fullHtml.match(/class=["'][^"']*has-custom-submenu-journeys[^"']*["'][\s\S]{0,16000}?(?=<li\b[^>]*class=["'][^"']*menu-destinations)/i);
    chunk = menu?.[0] || "";
  }

  const items = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = re.exec(chunk)) && items.length < 8) {
    const href = resolveNavigableUrl(attr(match[1], "href"), baseUrl);
    const label = cleanText(match[2]).slice(0, 60);
    const image = extractImageCandidates(match[2], baseUrl).find(Boolean) || null;
    if (!href || !label || /privacy|cookie|contact|see all/i.test(label)) continue;
    if (!items.some((item) => item.href === href || item.label === label)) items.push({ label, href, image });
  }
  return items;
}

function extractSectionsBlockAware(content, baseUrl, heroHeading, testimonials) {
  const headings = [];
  let re = /<h2\b([^>]*)>([\s\S]*?)<\/h2\s*>/gi;
  let match;
  while ((match = re.exec(content))) {
    const heading = cleanText(match[2]).slice(0, 150);
    if (!heading || heading === heroHeading || heading.length > 120) continue;
    headings.push({ heading, index: match.index, end: re.lastIndex, attrs: match[1] });
  }
  if (!headings.length) {
    re = /<h3\b([^>]*)>([\s\S]*?)<\/h3\s*>/gi;
    while ((match = re.exec(content))) {
      const heading = cleanText(match[2]).slice(0, 150);
      if (!heading || heading === heroHeading || heading.length > 100) continue;
      headings.push({ heading, index: match.index, end: re.lastIndex, attrs: match[1] });
    }
  }

  const sections = [];
  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    const next = headings[i + 1];
    const blockStart = findBlockStart(content, current.index);
    const end = Math.min(next?.index ?? content.length, blockStart + 18000);
    const slice = content.slice(blockStart, Math.max(current.end, end));
    const context = `${current.attrs} ${slice.slice(0, 2600)}`.toLowerCase();

    if (/cookie|privacy|contact form|newsletter/.test(context) && !/destination|membership|moment|encounter/.test(current.heading.toLowerCase())) continue;

    const images = unique(extractImageCandidates(slice, baseUrl)
      .map((url) => resolvePublicAsset(url, baseUrl))
      .filter((url) => url && !looksLikeUiAsset(url))).slice(0, 10);
    const paragraphs = extractParagraphs(slice, 4).map((item) => item.slice(0, 560));
    const links = extractLinks(slice, baseUrl, 6);
    const kind = classifyBlock(current.heading, context, images.length);

    if (kind === "testimonials" && testimonials.length) {
      sections.push({ heading: current.heading, kind, images: images.slice(0, 1), paragraphs: [], links: [], testimonials });
      continue;
    }
    if (!images.length && !paragraphs.length && !links.length && kind === "text") {
      sections.push({ heading: current.heading, kind: "callout", images: [], paragraphs: [], links: [] });
      continue;
    }

    sections.push({
      heading: current.heading,
      kind,
      images: images.slice(0, kind === "partners" || kind === "gallery" ? 10 : 4),
      paragraphs,
      links,
    });
  }

  return dedupeSections(sections);
}

function findBlockStart(content, headingIndex) {
  const from = Math.max(0, headingIndex - 9000);
  const window = content.slice(from, headingIndex);
  const re = /<(section|div)\b([^>]*)>/gi;
  let match;
  let best = { score: -1, index: headingIndex };
  while ((match = re.exec(window))) {
    const attrs = match[2] || "";
    const cls = attr(attrs, "class").toLowerCase();
    if (!cls) continue;
    if (/__inner|inner-container|spacer|buttons|button|slide|figure|content-wrapper|testimonial-wrapper|container\s/.test(cls)) continue;
    let score = match[1].toLowerCase() === "section" ? 5 : 0;
    if (/destinations-map-section|unforgettable-moments|unforgettable-encounters|memberships-slider|types-of-experiences/.test(cls)) score += 12;
    if (/\bwp-block-cover\b/.test(cls)) score += 8;
    if (/\bsection\b|section-/.test(cls)) score += 7;
    if (/\b[a-z0-9_-]+-block\b/.test(cls)) score += 6;
    if (/container-wrapper|alignfull/.test(cls)) score += 2;
    const absolute = from + match.index;
    if (score > best.score || (score === best.score && absolute > best.index)) best = { score, index: absolute };
  }
  return best.score >= 5 ? best.index : headingIndex;
}

function classifyBlock(heading, context, imageCount) {
  const text = `${heading} ${context}`.toLowerCase();
  if (/membership|memberships-slider|partner|association/.test(text)) return "partners";
  if (/unforgettable moments|testimonials-grid|testimonial/.test(text)) return "testimonials";
  if (/destination|destinations-map-section|explore map/.test(text)) return "destination-map";
  if (/ready to explore|^portugal\?$/.test(heading.toLowerCase())) return "callout";
  if (/encounter|journey|experience|tour|gallery|slider/.test(text) || imageCount >= 4) return "gallery";
  return imageCount ? "feature" : "text";
}

function mergeReadyExplore(sections) {
  const out = [];
  for (let i = 0; i < sections.length; i += 1) {
    const current = sections[i];
    const next = sections[i + 1];
    if (/^ready to explore$/i.test(current.heading) && /^portugal\?$/i.test(next?.heading || "")) {
      out.push({ ...current, heading: "Ready to explore Portugal?", kind: "callout" });
      i += 1;
      continue;
    }
    out.push(current);
  }
  return out;
}

function dedupeSections(sections) {
  const seen = new Set();
  return sections.filter((section) => {
    const key = section.heading.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractTestimonials(html) {
  const items = [];
  const re = /testimonials-card[\s\S]{0,2600}?<h3\b[^>]*>([\s\S]*?)<\/h3\s*>[\s\S]{0,900}?<h4\b[^>]*>([\s\S]*?)<\/h4\s*>/gi;
  let match;
  while ((match = re.exec(html)) && items.length < 10) {
    const quote = cleanText(match[1]);
    const author = cleanText(match[2]);
    if (quote.length > 20) items.push({ quote: quote.slice(0, 800), author: author.slice(0, 140) });
  }
  return items;
}

function detectBrandPalette(html) {
  const direct = (name, fallback) => normalizeHex(firstMatch(html, new RegExp(`--${name}\\s*:\\s*(#[0-9a-f]{3,6})\\b`, "i")) || fallback);
  let primary = direct("blue", "#171a48");
  let ink = direct("gray", "#59504f");
  let surface = direct("lightgray", "#f0f0f0");
  const dark = direct("darkerblue", "#0d0f19");
  const peach = firstMatch(html, /background(?:-color)?\s*:\s*(#ffe7c3)\b/i) || "#ffe7c3";

  if (!/^#[0-9a-f]{6}$/i.test(primary)) primary = "#171a48";
  if (!/^#[0-9a-f]{6}$/i.test(ink)) ink = "#59504f";
  if (!/^#[0-9a-f]{6}$/i.test(surface)) surface = "#f0f0f0";
  return { primary, ink, surface, dark, peach: normalizeHex(peach) };
}

function renderV21(model) {
  const p = model.palette;
  const brand = renderBrand(model.brand, model.siteName);
  const journeysMenu = model.journeys.length
    ? model.journeys.map((item) => `<a href="${escAttr(item.href)}">${esc(item.label)}</a>`).join("")
    : `<a href="#content">Explore</a>`;
  const navItems = buildGeneratedNav(model);
  const sectionHtml = model.sections.map(renderSectionV21).join("\n");
  const heroStyle = model.hero.image ? ` style="--hero-image:url('${cssUrl(model.hero.image)}')"` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="Passive Fetch / Render Auditor — Block-Aware Clean Reconstruction V2.1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' https: data: blob:; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; img-src https: data: blob:; style-src 'unsafe-inline'; font-src https: data:; media-src https: data: blob:">
<title>${esc(model.title || model.siteName)}</title>
<style>
:root{--brand:${p.primary};--ink:${p.ink};--surface:${p.surface};--dark:${p.dark};--peach:${p.peach};--paper:#fff;--radius:40px;--side:clamp(20px,3vw,40px);--serif:Georgia,"Times New Roman",serif;--sans:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:var(--ink);background:var(--paper);font-family:var(--sans);font-size:16px;line-height:1.5;overflow-x:hidden}a{color:inherit;text-decoration:none}button{font:inherit}img{display:block;max-width:100%}
.topbar{position:fixed;z-index:80;inset:0 0 auto;display:grid;grid-template-columns:1fr auto 1fr;align-items:start;padding:20px var(--side);pointer-events:none}.language,.brand,.menu-toggle{pointer-events:auto}.language{justify-self:start;background:var(--surface);border-radius:25px;padding:8px 17px;font-size:14px;color:var(--dark)}.brand{justify-self:center;max-width:190px;min-height:40px;display:grid;place-items:center;color:var(--brand)}.brand svg{width:186px;max-width:100%;height:auto}.brand img{max-height:40px;width:auto;border-radius:0}.brand-text{font-family:var(--serif);font-size:24px;letter-spacing:.08em}.menu-toggle{justify-self:end;width:46px;height:34px;border:0;border-radius:25px;background:var(--surface);cursor:pointer;display:grid;place-items:center}.menu-toggle i,.menu-toggle i:before,.menu-toggle i:after{display:block;width:14px;height:1px;background:var(--dark);content:"";transition:.25s}.menu-toggle i{position:relative}.menu-toggle i:before{position:absolute;top:-5px}.menu-toggle i:after{position:absolute;top:5px}
.menu-overlay{position:fixed;z-index:70;inset:0;background:var(--surface);padding:120px var(--side) 60px;opacity:0;visibility:hidden;transform:translateY(-10px);transition:.32s ease;overflow:auto}.menu-overlay.open{opacity:1;visibility:visible;transform:none}.menu-grid{width:min(1100px,100%);margin:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.menu-grid a{font-family:var(--serif);font-size:clamp(2rem,5vw,4.2rem);padding:18px 0;border-bottom:1px solid rgba(89,80,79,.15)}
.hero{position:relative;min-height:100svh;display:grid;place-items:center;isolation:isolate;overflow:hidden;background:var(--brand)}.hero:before{content:"";position:absolute;inset:0;background-image:var(--hero-image);background-size:cover;background-position:center;z-index:-2}.hero:after{content:"";position:absolute;inset:0;background:rgba(89,80,79,.50);z-index:-1}.hero-inner{width:min(1100px,calc(100% - 80px));text-align:center;color:#fff}.hero h1{margin:0 0 85px;font-family:var(--serif);font-weight:400;font-size:clamp(3.625rem,6.2vw,5.25rem);line-height:1.05;letter-spacing:-.025em;text-wrap:balance}.hero p{width:min(680px,100%);margin:-55px auto 80px;color:rgba(255,255,255,.9)}.scroll-down{position:absolute;bottom:0;left:50%;transform:translateX(-50%);color:#fff;font-size:12px}.scroll-down:after{content:"";display:block;width:1px;height:20px;background:#fff;margin:4px auto 0}
.journeys{position:fixed;z-index:75;left:50%;bottom:50%;transform:translate(-50%,130px)}.journeys-btn{border:0;border-radius:28px;background:var(--peach);color:var(--brand);padding:18px 30px;cursor:pointer;display:flex;align-items:center;gap:10px}.journeys-btn span{font-size:18px}.journeys-menu{position:absolute;left:50%;bottom:calc(100% + 8px);transform:translate(-50%,10px);background:var(--peach);border-radius:28px;padding:14px 28px;display:flex;gap:20px;opacity:0;visibility:hidden;pointer-events:none;transition:.28s ease;white-space:nowrap}.journeys.open .journeys-menu{opacity:1;visibility:visible;pointer-events:auto;transform:translate(-50%,0)}.journeys-menu a{color:var(--brand);font-size:15px}
.section{padding:clamp(90px,10vw,150px) var(--side)}.section-inner{width:min(1180px,100%);margin:auto}.section h2{font-family:var(--serif);font-weight:400;font-size:clamp(3rem,6vw,5.25rem);line-height:1.05;margin:0 0 42px;text-align:center;text-wrap:balance}.copy{width:min(760px,100%);margin:0 auto;color:var(--ink);text-align:center}.copy p{margin:0 0 22px}.feature{display:grid;grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);gap:clamp(28px,6vw,90px);align-items:center}.feature h2,.feature .copy{text-align:left;margin-left:0}.media{overflow:hidden;border-radius:var(--radius);background:var(--surface);min-height:360px}.media img{width:100%;height:100%;object-fit:cover}.gallery{display:grid;grid-template-columns:repeat(12,1fr);gap:20px}.gallery figure{margin:0;grid-column:span 4;aspect-ratio:4/3;overflow:hidden;border-radius:var(--radius);background:var(--surface)}.gallery figure:nth-child(4n+1){grid-column:span 6}.gallery img{width:100%;height:100%;object-fit:cover}.links{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:30px}.pill{padding:14px 24px;border-radius:30px;background:var(--brand);color:#fff}
.testimonial-section{position:relative;color:#fff;isolation:isolate;overflow:hidden;background:#93887e}.testimonial-section:before{content:"";position:absolute;inset:0;background-image:var(--section-bg);background-size:cover;background-position:center;z-index:-2}.testimonial-section:after{content:"";position:absolute;inset:0;background:rgba(89,80,79,.34);z-index:-1}.testimonial-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.quote{padding:30px;border-radius:30px;background:rgba(255,255,255,.12);backdrop-filter:blur(5px);border:1px solid rgba(255,255,255,.2)}.quote blockquote{margin:0;font-family:var(--serif);font-size:clamp(1.25rem,2vw,1.8rem);line-height:1.28}.quote cite{display:block;margin-top:20px;font-style:normal;opacity:.8}
.map-section{min-height:100svh;display:grid;place-items:center;position:relative;overflow:hidden;background:var(--surface);isolation:isolate}.map-section .map-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1}.map-card{text-align:center;width:min(700px,calc(100% - 40px));padding:40px;border-radius:34px;background:rgba(255,255,255,.72);backdrop-filter:blur(10px)}.map-card h2{margin-bottom:24px}.partners{display:flex;gap:20px;overflow:auto;scroll-snap-type:x mandatory;padding:6px 0 14px;scrollbar-width:none}.partner{flex:0 0 210px;min-height:140px;display:grid;place-items:center;padding:25px;border:1px solid rgba(89,80,79,.12);border-radius:30px;background:#fff;scroll-snap-align:start}.partner img{max-height:78px;width:auto;object-fit:contain;border-radius:0}.callout{padding-block:80px}.callout h2{margin:0;color:var(--ink)}
.reveal{opacity:0;transform:translateY(20px);transition:opacity .72s ease,transform .72s cubic-bezier(.2,.65,.25,1)}.reveal.visible{opacity:1;transform:none}.footer{padding:70px 20px;background:var(--dark);color:#fff;text-align:center}.footer small{opacity:.6}
@media(max-width:760px){.topbar{padding:20px}.brand{max-width:158px}.hero-inner{width:calc(100% - 40px)}.hero h1{font-size:3.625rem;margin-bottom:65px}.hero p{margin-top:-40px}.scroll-down{display:none}.journeys{bottom:28px;transform:translateX(-50%)}.journeys-menu{flex-direction:column;gap:14px;padding:24px}.menu-grid{grid-template-columns:1fr}.feature{grid-template-columns:1fr}.feature h2,.feature .copy{text-align:center}.gallery{grid-template-columns:1fr}.gallery figure,.gallery figure:nth-child(4n+1){grid-column:auto}.testimonial-grid{grid-template-columns:1fr}.section{padding-inline:20px}.section h2{font-size:3.625rem}.map-card{padding:28px 20px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.reveal{opacity:1;transform:none;transition:none}}
</style>
</head>
<body>
<header class="topbar"><a class="language" href="#top">EN</a><a class="brand" href="#top">${brand}</a><button class="menu-toggle" id="menuToggle" type="button" aria-expanded="false" aria-label="Menu"><i></i></button></header>
<div class="menu-overlay" id="menuOverlay"><nav class="menu-grid">${navItems}</nav></div>
<div class="journeys" id="journeys"><button class="journeys-btn" type="button" aria-expanded="false"><span>Journeys</span><b>☰</b></button><nav class="journeys-menu">${journeysMenu}</nav></div>
<main id="top">
<section class="hero"${heroStyle}><div class="hero-inner reveal visible"><h1>${esc(model.hero.heading || model.siteName)}</h1>${model.hero.subheading ? `<p>${esc(model.hero.subheading)}</p>` : ""}</div><a class="scroll-down" href="#content">scroll down</a></section>
<div id="content">${sectionHtml}</div>
</main>
<footer class="footer"><strong>${esc(model.siteName)}</strong><br><small>Block-aware clean reconstruction from public page content. Original backend, target JavaScript and target layout CSS are not included.</small></footer>
<script>
(()=>{const q=(s)=>document.querySelector(s),m=q('#menuOverlay'),mb=q('#menuToggle'),j=q('#journeys'),jb=j?.querySelector('.journeys-btn');mb?.addEventListener('click',()=>{const o=m.classList.toggle('open');mb.setAttribute('aria-expanded',String(o))});jb?.addEventListener('click',()=>{const o=j.classList.toggle('open');jb.setAttribute('aria-expanded',String(o))});document.addEventListener('click',e=>{if(j&&!j.contains(e.target)){j.classList.remove('open');jb?.setAttribute('aria-expanded','false')}});const io=new IntersectionObserver(es=>es.forEach(x=>{if(x.isIntersecting){x.target.classList.add('visible');io.unobserve(x.target)}}),{threshold:.10});document.querySelectorAll('.reveal').forEach(x=>io.observe(x));})();
</script>
</body></html>`;
}

function renderSectionV21(section) {
  const heading = esc(section.heading || "Discover");
  const paragraphs = (section.paragraphs || []).map((item) => `<p>${esc(item)}</p>`).join("");
  const links = renderLinks(section.links || []);

  if (section.kind === "callout") {
    return `<section class="section callout reveal"><div class="section-inner"><h2>${heading}</h2></div></section>`;
  }

  if (section.kind === "testimonials") {
    const bg = section.images?.[0] ? ` style="--section-bg:url('${cssUrl(section.images[0])}')"` : "";
    const cards = (section.testimonials || []).map((item) => `<article class="quote"><blockquote>${esc(item.quote)}</blockquote>${item.author ? `<cite>${esc(item.author)}</cite>` : ""}</article>`).join("");
    return `<section class="section testimonial-section reveal"${bg}><div class="section-inner"><h2>${heading}</h2><div class="testimonial-grid">${cards}</div></div></section>`;
  }

  if (section.kind === "destination-map") {
    const map = section.images?.find((url) => /map|\.svg(?:\?|$)/i.test(url)) || section.images?.[0] || "";
    return `<section class="section map-section reveal">${map ? `<img class="map-bg" src="${escAttr(map)}" alt="">` : ""}<div class="map-card"><h2>${heading}</h2><div class="copy">${paragraphs}</div>${links}</div></section>`;
  }

  if (section.kind === "partners") {
    return `<section class="section reveal"><div class="section-inner"><h2>${heading}</h2><div class="partners">${(section.images || []).map((url) => `<div class="partner"><img loading="lazy" src="${escAttr(url)}" alt=""></div>`).join("")}</div>${links}</div></section>`;
  }

  if (section.kind === "gallery") {
    return `<section class="section reveal"><div class="section-inner"><h2>${heading}</h2><div class="copy">${paragraphs}</div>${section.images?.length ? `<div class="gallery">${section.images.map((url) => `<figure><img loading="lazy" src="${escAttr(url)}" alt=""></figure>`).join("")}</div>` : ""}${links}</div></section>`;
  }

  if (section.images?.length) {
    return `<section class="section reveal"><div class="section-inner feature"><div><h2>${heading}</h2><div class="copy">${paragraphs}</div>${links}</div><div class="media"><img loading="lazy" src="${escAttr(section.images[0])}" alt=""></div></div></section>`;
  }
  return `<section class="section reveal"><div class="section-inner"><h2>${heading}</h2><div class="copy">${paragraphs}</div>${links}</div></section>`;
}

function renderBrand(brand, siteName) {
  if (brand?.type === "svg" && brand.markup) return brand.markup;
  if (brand?.type === "image" && brand.src) return `<img src="${escAttr(brand.src)}" alt="${escAttr(siteName)}">`;
  return `<span class="brand-text">${esc(siteName)}</span>`;
}

function buildGeneratedNav(model) {
  const items = [];
  for (const item of model.journeys.slice(0, 2)) items.push(item);
  const map = model.sections.find((section) => section.kind === "destination-map")?.links?.[0];
  if (map) items.push({ label: "Destinations", href: map.href });
  for (const section of model.sections) {
    if (items.length >= 6) break;
    const link = section.links?.[0];
    if (link && !items.some((item) => item.href === link.href)) items.push({ label: section.heading, href: link.href });
  }
  if (!items.length) return `<a href="#content">Discover</a>`;
  return items.slice(0, 6).map((item) => `<a href="${escAttr(item.href)}">${esc(item.label)}</a>`).join("");
}

function renderLinks(items) {
  if (!items?.length) return "";
  return `<div class="links">${items.slice(0, 5).map((item) => `<a class="pill" href="${escAttr(item.href)}">${esc(item.label)}</a>`).join("")}</div>`;
}

function extractParagraphs(html, max = 4) {
  const out = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi;
  let match;
  while ((match = re.exec(html)) && out.length < max) {
    const text = cleanText(match[1]);
    if (text.length < 20 || text.length > 1200) continue;
    if (/cookie|privacy preference|javascript|captcha/i.test(text)) continue;
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

function extractLinks(html, baseUrl, max = 6) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = re.exec(html)) && out.length < max) {
    const label = cleanText(match[2]).slice(0, 90);
    const href = resolveNavigableUrl(attr(match[1], "href"), baseUrl);
    if (!href || !label || label.length < 2 || /privacy policy|cookie policy|change cookie/i.test(label)) continue;
    if (!out.some((item) => item.href === href || item.label === label)) out.push({ label, href });
  }
  return out;
}

function extractImageCandidates(html, baseUrl) {
  const out = [];
  const re = /<img\b([^>]*)>/gi;
  let match;
  while ((match = re.exec(html)) && out.length < 120) {
    const attrs = match[1];
    const src = attr(attrs, "src") || attr(attrs, "data-src");
    const resolved = resolvePublicAsset(src, baseUrl);
    if (resolved) out.push(resolved);
  }
  return out;
}

function sanitizeSvg(svg) {
  return String(svg || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(["']).*?\1/gi, "")
    .replace(/\s(?:href|xlink:href)\s*=\s*(["'])javascript:[\s\S]*?\1/gi, "");
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
        "user-agent": "Passive-Fetch-Render-Auditor/2.1 Block-Aware-Clean-Reconstruction",
        dnt: "1",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl: current, redirects };
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

function authorize(request, env) {
  if (!env.AUDIT_KEY) return json({ error: "Server is not armed yet. Configure AUDIT_KEY first.", code: "AUDIT_KEY_MISSING" }, 503);
  const auth = request.headers.get("authorization") || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!safeEqual(supplied, String(env.AUDIT_KEY))) return json({ error: "Invalid access key", code: "UNAUTHORIZED" }, 401);
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
  if (!isSafePublicUrl(url)) throw new Error("Only public HTTP(S) URLs are allowed. Private, local, credential-bearing, or non-web targets are blocked.");
}

function isSafePublicUrl(url) {
  if (!(url instanceof URL) || !["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const p = host.split(".").map(Number);
    if (p.some((x) => x < 0 || x > 255)) return false;
    const [a, b] = p;
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return false;
  return true;
}

function resolveNavigableUrl(value, baseUrl) {
  if (!value || /^#|^mailto:|^tel:|^javascript:/i.test(value)) return null;
  try {
    const url = new URL(decodeEntities(value), baseUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function resolvePublicAsset(value, baseUrl) {
  if (!value || /^data:/i.test(value)) return null;
  try {
    const url = new URL(decodeEntities(value), baseUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function looksLikeUiAsset(url) {
  return /favicon|apple-touch|gravatar|emoji|spinner|loader|pixel|tracking|cropped-domitur-site-identity/i.test(url);
}
function attr(attrs, name) {
  return attrs.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2]
    || attrs.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i"))?.[1]
    || "";
}
function firstMatch(text, re) { return text.match(re)?.[1] || ""; }
function cleanText(value) {
  return decodeEntities(String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}
function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function normalizeHex(value) {
  const v = String(value || "").toLowerCase();
  return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
}
function unique(items) { return [...new Set(items)]; }
function esc(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function escAttr(value) { return esc(value).replace(/`/g, "&#96;"); }
function cssUrl(value) { return String(value || "").replace(/[\\'"\n\r()]/g, (ch) => `\\${ch}`); }
function safeFilename(value) {
  const name = cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
  return name || "reconstruction";
}
function byteLength(value) { return new TextEncoder().encode(String(value || "")).byteLength; }
function cleanError(error) { return String(error?.message || error || "Unknown error").replace(/[\r\n]+/g, " ").slice(0, 500); }
function safeEqual(a, b) {
  const x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  let out = 0;
  for (let i = 0; i < x.length; i += 1) out |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return out === 0;
}
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS }); }
