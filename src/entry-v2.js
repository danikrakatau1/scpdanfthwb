import app from "./entry-v163.js";

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
        buildWebMode: "v2-clean-reconstruction + v1-static-snapshot-fallback",
        cleanReconstructionEngine: true,
        cleanReconstructionUsesTargetScripts: false,
        cleanReconstructionUsesTargetCssAsLayout: false,
        cleanReconstructionBrowserQuotaUsed: false,
        v1CompatibilityEngine: "1.6.3",
        version: "2.0.0",
      });
    }

    if (url.pathname === "/api/build-v2" && request.method === "POST") {
      return handleCleanBuild(request, env);
    }

    return app.fetch(request, env, ctx);
  },
};

async function handleCleanBuild(request, env) {
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
      return json({
        error: `Target returned HTTP ${response.status}`,
        code: "BUILD_TARGET_HTTP_ERROR",
        target: target.href,
      }, 502);
    }

    if (!/html|xhtml/i.test(contentType)) {
      return json({
        error: `Build Web V2 requires an HTML document. Received ${contentType || "unknown content type"}.`,
        code: "BUILD_NOT_HTML",
      }, 415);
    }

    const rawHtml = await response.text();
    if (byteLength(rawHtml) > MAX_HTML_BYTES) {
      return json({ error: "Source HTML is too large for Clean Reconstruction.", code: "BUILD_TOO_LARGE" }, 413);
    }

    const model = extractPageModel(rawHtml, fetched.finalUrl);
    const built = renderCleanReconstruction(model, fetched.finalUrl);

    return json({
      ok: true,
      target: target.href,
      finalUrl: fetched.finalUrl.href,
      builtAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      engine: "v2-clean-reconstruction",
      mode: "clean-reconstruction-v2",
      source: "public-content-model",
      browserQuotaUsed: false,
      filename: `${safeFilename(model.siteName || model.title || fetched.finalUrl.hostname)}-clean-v2.html`,
      title: model.title || model.siteName || "Clean reconstruction",
      htmlBytes: byteLength(built),
      html: built,
      stats: {
        sectionsDetected: model.sections.length,
        testimonialsDetected: model.testimonials.length,
        navigationLinksDetected: model.navLinks.length,
        imagesSelected: model.allSelectedImages.length,
        targetScriptsCopied: 0,
        targetStylesheetsCopied: 0,
        generatedInteractions: 3,
      },
      model: {
        siteName: model.siteName,
        heroHeading: model.hero.heading,
        sectionHeadings: model.sections.map((section) => section.heading).filter(Boolean),
        palette: model.palette,
      },
      safety: {
        targetScriptsCopied: false,
        targetJavaScriptExecutedByBuild: false,
        targetCssUsedAsLayoutFoundation: false,
        formsGenerated: false,
        framesGenerated: false,
        networkConnectDisabled: true,
        remotePublicImagesMayRemain: true,
        onlyGeneratedInteractionScriptIncluded: true,
      },
    });
  } catch (error) {
    return json({
      error: cleanError(error),
      code: "BUILD_V2_FAILED",
      durationMs: Date.now() - startedAt,
    }, 502);
  }
}

function extractPageModel(rawHtml, baseUrl) {
  const html = String(rawHtml || "");
  const title = cleanText(firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i));
  const description = cleanText(
    firstMatch(html, /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    firstMatch(html, /<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
  );
  const siteName = cleanText(
    firstMatch(html, /<meta\b[^>]*property=["']og:site_name["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    title.split(/[|–—-]/)[0] || baseUrl.hostname
  ).slice(0, 80);

  const palette = detectPalette(html);
  const navLinks = extractNavigationLinks(html, baseUrl).slice(0, 8);
  const logoUrl = extractLogoUrl(html, baseUrl);
  const hero = extractHero(html, baseUrl, title, description);
  const testimonials = extractTestimonials(html).slice(0, 6);
  const sections = extractSections(html, baseUrl, hero.heading, testimonials).slice(0, 10);

  const selected = [hero.image, logoUrl];
  for (const section of sections) selected.push(...section.images);
  const allSelectedImages = unique(selected.filter(Boolean)).slice(0, 40);

  return {
    title,
    description,
    siteName: siteName || baseUrl.hostname,
    logoUrl,
    palette,
    navLinks,
    hero,
    testimonials,
    sections,
    allSelectedImages,
  };
}

function extractHero(html, baseUrl, title, description) {
  const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i);
  const heading = cleanText(h1Match?.[1] || title || "Welcome").slice(0, 150);
  const around = h1Match?.index != null ? html.slice(Math.max(0, h1Match.index - 3000), h1Match.index + 7000) : html.slice(0, 14000);
  const candidates = [
    firstMatch(html, /<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i),
    ...extractImageCandidates(around, baseUrl),
    ...extractImageCandidates(html.slice(0, 30000), baseUrl),
  ].map((url) => resolvePublicAsset(url, baseUrl)).filter(Boolean);

  const image = candidates.find((url) => !looksLikeUiAsset(url)) || null;
  const paragraphs = extractParagraphs(around, 2);
  const subheading = paragraphs.find((item) => item.length >= 30 && !heading.includes(item)) || description || "";
  return { heading, subheading: subheading.slice(0, 320), image };
}

function extractNavigationLinks(html, baseUrl) {
  const navChunk = firstMatch(html, /<(?:nav|header)\b[^>]*>([\s\S]*?)<\/(?:nav|header)\s*>/i) || html.slice(0, 35000);
  const links = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = re.exec(navChunk)) && links.length < 30) {
    const href = attr(match[1], "href");
    const label = cleanText(match[2]).slice(0, 48);
    const url = resolveNavigableUrl(href, baseUrl);
    if (!url || !label || label.length < 2 || /^skip|^menu$|^home$/i.test(label)) continue;
    if (!links.some((item) => item.label === label || item.href === url)) links.push({ label, href: url });
  }
  return links;
}

function extractLogoUrl(html, baseUrl) {
  const re = /<img\b([^>]*)>/gi;
  let match;
  const candidates = [];
  while ((match = re.exec(html)) && candidates.length < 80) {
    const attrs = match[1];
    const haystack = `${attrs} ${attr(attrs, "alt") || ""}`.toLowerCase();
    if (!/logo|brand|identity/.test(haystack)) continue;
    const src = resolvePublicAsset(attr(attrs, "src") || attr(attrs, "data-src"), baseUrl);
    if (src) candidates.push(src);
  }
  return candidates.find((url) => !/favicon|icon/i.test(url)) || null;
}

function extractSections(html, baseUrl, heroHeading, testimonials) {
  const headings = [];
  const re = /<h([2-3])\b([^>]*)>([\s\S]*?)<\/h\1\s*>/gi;
  let match;
  while ((match = re.exec(html))) {
    const heading = cleanText(match[3]).slice(0, 120);
    if (!heading || heading.length < 3) continue;
    if (heading === heroHeading) continue;
    if (/toggle submenu|read article/i.test(heading)) continue;
    headings.push({ heading, index: match.index, end: re.lastIndex, attrs: match[2] });
    if (headings.length >= 32) break;
  }

  const sections = [];
  for (let i = 0; i < headings.length; i += 1) {
    const current = headings[i];
    const next = headings[i + 1];
    const end = Math.min(next?.index ?? current.end + 9000, current.end + 9000);
    const slice = html.slice(current.end, end);
    const context = `${current.attrs} ${slice.slice(0, 1800)}`.toLowerCase();
    if (/testimonial/.test(context) && testimonials.length) continue;

    const paragraphs = extractParagraphs(slice, 3);
    const images = extractImageCandidates(slice, baseUrl)
      .map((url) => resolvePublicAsset(url, baseUrl))
      .filter((url) => url && !looksLikeUiAsset(url));
    const links = extractLinks(slice, baseUrl, 5);
    const kind = classifySection(current.heading, context, images.length, links.length);

    if (!paragraphs.length && !images.length && !links.length && kind === "text") continue;
    if (sections.some((section) => section.heading.toLowerCase() === current.heading.toLowerCase())) continue;

    sections.push({
      heading: current.heading,
      paragraphs: paragraphs.map((item) => item.slice(0, 520)),
      images: unique(images).slice(0, kind === "gallery" || kind === "partners" ? 8 : 4),
      links,
      kind,
    });
    if (sections.length >= 12) break;
  }
  return sections;
}

function extractTestimonials(html) {
  const items = [];
  const re = /testimonials-card[\s\S]{0,2200}?<h3\b[^>]*>([\s\S]*?)<\/h3\s*>[\s\S]{0,700}?<h4\b[^>]*>([\s\S]*?)<\/h4\s*>/gi;
  let match;
  while ((match = re.exec(html)) && items.length < 10) {
    const quote = cleanText(match[1]);
    const author = cleanText(match[2]);
    if (quote.length > 20) items.push({ quote: quote.slice(0, 650), author: author.slice(0, 120) });
  }
  return items;
}

function classifySection(heading, context, imageCount, linkCount) {
  const text = `${heading} ${context}`.toLowerCase();
  if (/testimonial|moment|review|client feedback/.test(text)) return "testimonials";
  if (/destination|map|location/.test(text)) return "destination";
  if (/membership|partner|association|sponsor/.test(text)) return "partners";
  if (/gallery|journey|experience|tour|collection|portfolio/.test(text) || imageCount >= 4) return "gallery";
  if (linkCount >= 3 && imageCount >= 2) return "cards";
  return imageCount ? "feature" : "text";
}

function extractParagraphs(html, max = 3) {
  const out = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi;
  let match;
  while ((match = re.exec(html)) && out.length < max) {
    const text = cleanText(match[1]);
    if (text.length < 20 || text.length > 1200) continue;
    if (/cookie|privacy preference|javascript/i.test(text)) continue;
    out.push(text);
  }
  return out;
}

function extractLinks(html, baseUrl, max = 5) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match;
  while ((match = re.exec(html)) && out.length < max) {
    const label = cleanText(match[2]).slice(0, 80);
    const href = resolveNavigableUrl(attr(match[1], "href"), baseUrl);
    if (!href || !label || label.length < 2) continue;
    if (!out.some((item) => item.href === href || item.label === label)) out.push({ label, href });
  }
  return out;
}

function extractImageCandidates(html, baseUrl) {
  const out = [];
  const re = /<img\b([^>]*)>/gi;
  let match;
  while ((match = re.exec(html)) && out.length < 80) {
    const attrs = match[1];
    const src = attr(attrs, "src") || attr(attrs, "data-src");
    const resolved = resolvePublicAsset(src, baseUrl);
    if (resolved) out.push(resolved);
  }
  return out;
}

function detectPalette(html) {
  const vars = [];
  const re = /--([a-z0-9_-]+)\s*:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/gi;
  let match;
  while ((match = re.exec(html)) && vars.length < 120) vars.push({ name: match[1].toLowerCase(), value: normalizeHex(match[2]) });

  const preferred = (keywords, fallback) => vars.find((item) => keywords.some((key) => item.name.includes(key)))?.value || fallback;
  const primary = preferred(["blue", "primary", "brand", "accent", "darkgreen", "darkteal"], "#171a48");
  const ink = preferred(["darkerblue", "foreground", "ink", "gray"], "#202127");
  const surface = preferred(["lightgray", "background", "cream", "sand"], "#f4f2ee");
  return { primary, ink, surface };
}

function renderCleanReconstruction(model, baseUrl) {
  const palette = model.palette;
  const nav = model.navLinks.length
    ? model.navLinks.map((item) => `<a href="${escAttr(item.href)}">${esc(item.label)}</a>`).join("")
    : "";
  const heroImageStyle = model.hero.image ? ` style="--hero-image:url('${cssUrl(model.hero.image)}')"` : "";
  const logo = model.logoUrl
    ? `<img class="brand-logo" src="${escAttr(model.logoUrl)}" alt="${escAttr(model.siteName)}" />`
    : `<span class="brand-wordmark">${esc(model.siteName)}</span>`;

  const sections = [];
  for (const section of model.sections) {
    if (section.kind === "testimonials" && model.testimonials.length) continue;
    sections.push(renderSection(section));
  }
  if (model.testimonials.length) sections.splice(Math.min(2, sections.length), 0, renderTestimonials(model.testimonials));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="Passive Fetch / Render Auditor — Clean Reconstruction V2">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' https: data: blob:; script-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; img-src https: data: blob:; style-src 'unsafe-inline'; font-src https: data:; media-src https: data: blob:">
<title>${esc(model.title || model.siteName)}</title>
<style>
:root{--primary:${palette.primary};--ink:${palette.ink};--surface:${palette.surface};--paper:#fff;--muted:#6d6e73;--line:rgba(20,22,28,.12);--radius:32px;--shadow:0 24px 80px rgba(10,14,32,.13)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55;overflow-x:hidden}a{color:inherit;text-decoration:none}img{display:block;max-width:100%}
.site-header{position:fixed;z-index:50;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;padding:22px clamp(20px,4vw,64px);pointer-events:none}.brand,.explore-toggle{pointer-events:auto}.brand{display:flex;align-items:center;min-height:46px;max-width:220px;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.78);backdrop-filter:blur(16px);box-shadow:0 8px 30px rgba(0,0,0,.08)}.brand-logo{max-height:34px;width:auto}.brand-wordmark{font-family:Georgia,serif;letter-spacing:.16em;text-transform:uppercase;font-size:15px;color:var(--primary)}
.explore{position:relative;pointer-events:auto}.explore-toggle{border:0;background:#ffe7c3;color:var(--primary);border-radius:999px;padding:15px 22px;font:inherit;cursor:pointer;box-shadow:0 8px 30px rgba(0,0,0,.08)}.explore-menu{position:absolute;right:0;top:calc(100% + 10px);display:grid;min-width:230px;padding:10px;border-radius:24px;background:rgba(255,255,255,.95);backdrop-filter:blur(18px);box-shadow:var(--shadow);opacity:0;visibility:hidden;transform:translateY(-8px);transition:.24s ease}.explore.open .explore-menu{opacity:1;visibility:visible;transform:none}.explore-menu a{padding:11px 13px;border-radius:14px;font-size:14px}.explore-menu a:hover{background:var(--surface)}
.hero{min-height:100svh;display:grid;place-items:center;position:relative;padding:130px 24px 90px;background:linear-gradient(145deg,var(--primary),#3b3d50);isolation:isolate;overflow:hidden}${heroImageStyle}.hero:before{content:"";position:absolute;inset:0;background-image:var(--hero-image);background-size:cover;background-position:center;z-index:-2}.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,10,22,.20),rgba(8,10,22,.52));z-index:-1}.hero-inner{width:min(1050px,100%);text-align:center;color:white}.hero h1{margin:0 auto;font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:clamp(3rem,8vw,7.3rem);line-height:.95;letter-spacing:-.045em;text-wrap:balance}.hero p{width:min(720px,100%);margin:30px auto 0;font-size:clamp(1rem,1.7vw,1.25rem);color:rgba(255,255,255,.86)}.scroll-cue{position:absolute;bottom:24px;color:white;font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.8}
.section{padding:clamp(80px,10vw,150px) clamp(20px,5vw,80px)}.section:nth-child(even){background:var(--surface)}.section-inner{width:min(1180px,100%);margin:0 auto}.eyebrow{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--primary);margin-bottom:16px}.section h2{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:clamp(2.4rem,5.5vw,5.2rem);line-height:1;letter-spacing:-.035em;margin:0 0 28px;text-wrap:balance}.section-copy{width:min(760px,100%);font-size:clamp(1rem,1.4vw,1.15rem);color:#55585e}.section-copy p{margin:0 0 18px}
.feature-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:clamp(28px,5vw,72px);align-items:center}.media-card{overflow:hidden;border-radius:var(--radius);background:#ddd;aspect-ratio:4/3;box-shadow:var(--shadow)}.media-card img{width:100%;height:100%;object-fit:cover}.gallery-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:18px;margin-top:42px}.gallery-card{grid-column:span 4;overflow:hidden;border-radius:26px;aspect-ratio:4/3;background:#ddd;position:relative}.gallery-card:nth-child(4n+1){grid-column:span 6;aspect-ratio:16/10}.gallery-card img{width:100%;height:100%;object-fit:cover;transition:transform .6s cubic-bezier(.2,.65,.25,1)}.gallery-card:hover img{transform:scale(1.035)}
.link-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}.pill{display:inline-flex;padding:12px 18px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.7);font-size:14px}.pill:hover{border-color:var(--primary)}
.testimonials{background:var(--primary)!important;color:white}.testimonials .eyebrow{color:#ffe7c3}.testimonial-track{display:flex;gap:18px;overflow:auto;scroll-snap-type:x mandatory;padding:14px 0 18px;scrollbar-width:none}.testimonial-card{flex:0 0 min(520px,88vw);scroll-snap-align:start;padding:34px;border-radius:28px;background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.14)}.testimonial-card blockquote{margin:0;font-family:Georgia,serif;font-size:clamp(1.25rem,2.1vw,1.85rem);line-height:1.25}.testimonial-card cite{display:block;margin-top:24px;font-style:normal;color:rgba(255,255,255,.72)}
.partners{display:flex;gap:18px;overflow:auto;padding:12px 0;scrollbar-width:none}.partner{flex:0 0 180px;display:grid;place-items:center;min-height:120px;padding:20px;border-radius:24px;background:white;border:1px solid var(--line)}.partner img{max-height:72px;width:auto;object-fit:contain;filter:saturate(.75)}
.destination{position:relative;overflow:hidden;background:var(--surface)!important}.destination .media-card{aspect-ratio:16/10;background:transparent;box-shadow:none}.destination .media-card img{object-fit:contain}
.reveal{opacity:0;transform:translateY(22px);transition:opacity .75s ease,transform .75s cubic-bezier(.2,.65,.25,1)}.reveal.visible{opacity:1;transform:none}
.site-footer{padding:60px 24px 80px;background:#0d0f19;color:white;text-align:center}.site-footer small{opacity:.6}
@media(max-width:760px){.site-header{padding:16px}.brand{max-width:170px}.explore-toggle{padding:13px 18px}.hero{padding-inline:18px}.hero h1{font-size:clamp(3rem,14vw,4.8rem)}.feature-grid{grid-template-columns:1fr}.gallery-grid{grid-template-columns:1fr}.gallery-card,.gallery-card:nth-child(4n+1){grid-column:auto;aspect-ratio:4/3}.section{padding-inline:20px}.testimonial-card{padding:26px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.reveal{opacity:1;transform:none;transition:none}.gallery-card img{transition:none}}
</style>
</head>
<body>
<header class="site-header">
  <a class="brand" href="#top">${logo}</a>
  <div class="explore" id="explore">
    <button class="explore-toggle" type="button" aria-expanded="false">Explore</button>
    <nav class="explore-menu" aria-label="Public page navigation">${nav || `<a href="#content">Discover</a>`}</nav>
  </div>
</header>
<main id="top">
  <section class="hero">
    <div class="hero-inner reveal visible">
      <h1>${esc(model.hero.heading || model.siteName)}</h1>
      ${model.hero.subheading ? `<p>${esc(model.hero.subheading)}</p>` : ""}
    </div>
    <a class="scroll-cue" href="#content">Scroll</a>
  </section>
  <div id="content">${sections.join("\n")}</div>
</main>
<footer class="site-footer"><strong>${esc(model.siteName)}</strong><br><small>Clean reconstruction generated from public page content. Original backend and target JavaScript are not included.</small></footer>
<script>
(()=>{const e=document.getElementById('explore'),b=e?.querySelector('.explore-toggle');b?.addEventListener('click',()=>{const o=e.classList.toggle('open');b.setAttribute('aria-expanded',String(o))});document.addEventListener('click',x=>{if(e&&!e.contains(x.target)){e.classList.remove('open');b?.setAttribute('aria-expanded','false')}});const io=new IntersectionObserver(es=>es.forEach(x=>{if(x.isIntersecting){x.target.classList.add('visible');io.unobserve(x.target)}}),{threshold:.12});document.querySelectorAll('.reveal').forEach(x=>io.observe(x));})();
</script>
</body>
</html>`;
}

function renderSection(section) {
  const heading = esc(section.heading || "Discover");
  const paragraphs = section.paragraphs.map((item) => `<p>${esc(item)}</p>`).join("");
  const links = section.links.length
    ? `<div class="link-row">${section.links.map((item) => `<a class="pill" href="${escAttr(item.href)}">${esc(item.label)}</a>`).join("")}</div>`
    : "";

  if (section.kind === "partners") {
    return `<section class="section reveal"><div class="section-inner"><div class="eyebrow">Network</div><h2>${heading}</h2><div class="section-copy">${paragraphs}</div><div class="partners">${section.images.map((url) => `<div class="partner"><img src="${escAttr(url)}" alt=""></div>`).join("")}</div>${links}</div></section>`;
  }

  if (section.kind === "destination") {
    const image = section.images[0];
    return `<section class="section destination reveal"><div class="section-inner feature-grid"><div><div class="eyebrow">Explore</div><h2>${heading}</h2><div class="section-copy">${paragraphs}</div>${links}</div>${image ? `<div class="media-card"><img src="${escAttr(image)}" alt=""></div>` : ""}</div></section>`;
  }

  if (section.kind === "gallery" || section.kind === "cards") {
    return `<section class="section reveal"><div class="section-inner"><div class="eyebrow">Highlights</div><h2>${heading}</h2><div class="section-copy">${paragraphs}</div>${section.images.length ? `<div class="gallery-grid">${section.images.map((url) => `<div class="gallery-card"><img loading="lazy" src="${escAttr(url)}" alt=""></div>`).join("")}</div>` : ""}${links}</div></section>`;
  }

  if (section.images.length) {
    return `<section class="section reveal"><div class="section-inner feature-grid"><div><div class="eyebrow">Story</div><h2>${heading}</h2><div class="section-copy">${paragraphs}</div>${links}</div><div class="media-card"><img loading="lazy" src="${escAttr(section.images[0])}" alt=""></div></div></section>`;
  }

  return `<section class="section reveal"><div class="section-inner"><div class="eyebrow">Story</div><h2>${heading}</h2><div class="section-copy">${paragraphs}</div>${links}</div></section>`;
}

function renderTestimonials(items) {
  return `<section class="section testimonials reveal"><div class="section-inner"><div class="eyebrow">Testimonials</div><h2>What people remember</h2><div class="testimonial-track">${items.map((item) => `<article class="testimonial-card"><blockquote>${esc(item.quote)}</blockquote>${item.author ? `<cite>${esc(item.author)}</cite>` : ""}</article>`).join("")}</div></div></section>`;
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
        "user-agent": "Passive-Fetch-Render-Auditor/2.0 Clean-Reconstruction",
        dnt: "1",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (![301,302,303,307,308].includes(response.status)) return { response, finalUrl: current, redirects };
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
  if (!(url instanceof URL) || !["http:","https:"].includes(url.protocol) || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const p = host.split(".").map(Number); if (p.some((x)=>x<0||x>255)) return false;
    const [a,b]=p; if (a===0||a===10||a===127||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)) return false;
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) return false;
  return true;
}

function resolveNavigableUrl(value, baseUrl) {
  if (!value || /^#|^mailto:|^tel:|^javascript:/i.test(value)) return null;
  try { const url = new URL(value, baseUrl); return ["http:","https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}

function resolvePublicAsset(value, baseUrl) {
  if (!value || /^data:/i.test(value)) return null;
  try { const url = new URL(decodeEntities(value), baseUrl); return ["http:","https:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}

function looksLikeUiAsset(url) { return /favicon|apple-touch|gravatar|emoji|icon[-_.]|logo[-_.]?mark|spinner|loader|pixel|tracking/i.test(url); }
function attr(attrs, name) { return attrs.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2] || attrs.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i"))?.[1] || ""; }
function firstMatch(text, re) { return text.match(re)?.[1] || ""; }
function cleanText(value) { return decodeEntities(String(value || "").replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi," ").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()); }
function decodeEntities(value) { return String(value || "").replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#0*39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))); }
function normalizeHex(value) { const v=String(value).toLowerCase(); return v.length===4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v; }
function unique(items) { return [...new Set(items)]; }
function esc(value) { return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function escAttr(value) { return esc(value).replace(/`/g,"&#96;"); }
function cssUrl(value) { return String(value || "").replace(/[\\'"\n\r()]/g, (ch)=>`\\${ch}`); }
function safeFilename(value) { const name=cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,70); return name || "reconstruction"; }
function byteLength(value) { return new TextEncoder().encode(String(value || "")).byteLength; }
function cleanError(error) { return String(error?.message || error || "Unknown error").replace(/[\r\n]+/g," ").slice(0,500); }
function safeEqual(a,b){ const x=String(a),y=String(b); if(x.length!==y.length)return false; let out=0; for(let i=0;i<x.length;i++)out|=x.charCodeAt(i)^y.charCodeAt(i); return out===0; }
function json(value,status=200){ return new Response(JSON.stringify(value),{status,headers:JSON_HEADERS}); }
