import puppeteer from "@cloudflare/puppeteer";
import app from "./entry-v13.js";

const BROWSER_TIMEOUT_MS = 20_000;
const RENDER_SETTLE_MS = 1_200;
const MAX_NETWORK = 120;
const MAX_BUILD_HTML_BYTES = 2_500_000;
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
        buildWebMode: "deep-rendered-snapshot-v14 + raw-http-fallback-v13",
        renderedSnapshotBuild: true,
        staticCompatibilityLayer: true,
        version: "1.4.0",
      });
    }

    if (url.pathname === "/api/scan" && request.method === "POST") {
      return handleScanV14(request, env, ctx);
    }

    return app.fetch(request, env, ctx);
  },
};

async function handleScanV14(request, env, ctx) {
  let input;
  try {
    input = await request.clone().json();
  } catch {
    return app.fetch(request, env, ctx);
  }

  if (input?.mode !== "deep") {
    return app.fetch(request, env, ctx);
  }

  const startedAt = Date.now();
  const quickHeaders = new Headers({ "content-type": "application/json" });
  const auth = request.headers.get("authorization");
  if (auth) quickHeaders.set("authorization", auth);

  const quickRequest = new Request(request.url, {
    method: "POST",
    headers: quickHeaders,
    body: JSON.stringify({ ...input, mode: "quick" }),
  });

  const quickResponse = await app.fetch(quickRequest, env, ctx);
  const quickReport = await quickResponse.json().catch(() => null);
  if (!quickResponse.ok || !quickReport) {
    return json(quickReport || { error: `HTTP ${quickResponse.status}` }, quickResponse.status);
  }

  if (!env.BROWSER) {
    return json({
      ...quickReport,
      mode: "deep",
      durationMs: Date.now() - startedAt,
      rendered: { ok: false, error: "Cloudflare Browser Run binding is not available." },
      comparison: null,
      buildWeb: {
        available: true,
        mode: "raw-http-static-reconstruction-v13",
        source: "raw-http-fallback",
        prebuilt: null,
        note: "Rendered snapshot was unavailable, so Build Web will use the raw HTTP fallback.",
      },
    });
  }

  const renderedResult = await renderAndSnapshot(quickReport.target, env.BROWSER);
  const rendered = renderedResult.public;
  const comparison = rendered?.ok ? compareRawAndRendered(quickReport.raw, rendered) : null;
  const verdict = buildVerdict(quickReport.raw, rendered, comparison);
  const fetchabilityScore = buildFetchabilityScore(quickReport.raw, rendered);

  let prebuilt = null;
  if (renderedResult.snapshot?.ok && renderedResult.snapshot.html) {
    const htmlBytes = byteLength(renderedResult.snapshot.html);
    if (htmlBytes <= MAX_BUILD_HTML_BYTES) {
      prebuilt = {
        ok: true,
        target: quickReport.target,
        finalUrl: renderedResult.snapshot.finalUrl,
        builtAt: new Date().toISOString(),
        durationMs: renderedResult.snapshot.durationMs,
        mode: "sanitized-rendered-static-reconstruction-v14",
        source: "deep-rendered-dom",
        browserQuotaUsed: false,
        browserReuse: "same-browser-as-deep-scan",
        filename: safeFilename(renderedResult.snapshot.title || new URL(renderedResult.snapshot.finalUrl).hostname) + ".html",
        htmlBytes,
        title: renderedResult.snapshot.title,
        stats: renderedResult.snapshot.stats,
        html: renderedResult.snapshot.html,
        safety: {
          scriptsRemoved: true,
          framesRemoved: true,
          formSubmissionRemoved: true,
          inlineEventHandlersRemoved: true,
          javascriptUrlsRemoved: true,
          restrictiveCspInjected: true,
          remotePublicAssetsMayRemain: true,
          currentRenderedDomCaptured: true,
          lazyMediaResolvedFromBrowser: true,
          initialLoadersSuppressed: true,
        },
      };
    }
  }

  return json({
    ...quickReport,
    mode: "deep",
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    verdict,
    fetchabilityScore,
    rendered,
    comparison,
    buildWeb: {
      available: true,
      mode: prebuilt ? "rendered-static-reconstruction-v14" : "raw-http-static-reconstruction-v13",
      source: prebuilt ? "deep-rendered-dom" : "raw-http-fallback",
      prebuilt,
      snapshotStatus: prebuilt ? "ready" : renderedResult.snapshot?.error || "snapshot unavailable",
      note: prebuilt
        ? "Deep Scan captured and sanitized the post-JavaScript DOM in the same Browser Run. Build Web can use this snapshot without launching another browser."
        : "Rendered snapshot was unavailable or too large, so Build Web will fall back to raw HTTP reconstruction.",
    },
    safety: {
      ...(quickReport.safety || {}),
      passiveScrollSweep: true,
      browserRunsForDeepScan: 1,
      browserRunsForDeepBuild: 0,
    },
  });
}

async function renderAndSnapshot(targetUrl, browserBinding) {
  const started = Date.now();
  let browser;
  const requests = new Map();
  const blockedRequests = [];

  try {
    const target = new URL(targetUrl);
    assertPublicUrl(target);

    browser = await puppeteer.launch(browserBinding);
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS);
    await page.setViewport({ width: 1365, height: 900, deviceScaleFactor: 1 });
    await page.setUserAgent("Passive-Fetch-Render-Auditor/1.4 (Cloudflare Browser Run)");
    await page.setExtraHTTPHeaders({ DNT: "1" });
    await page.setRequestInterception(true);

    page.on("request", (req) => {
      const method = req.method().toUpperCase();
      const requestUrl = req.url();
      try {
        const parsed = new URL(requestUrl);
        if (!isSafePublicUrl(parsed) || !["GET", "HEAD"].includes(method)) {
          if (blockedRequests.length < 30) {
            blockedRequests.push({ url: requestUrl, method, reason: "blocked-passive-policy" });
          }
          req.abort("blockedbyclient").catch(() => {});
          return;
        }

        if (requests.size < MAX_NETWORK) {
          requests.set(requestUrl, {
            url: requestUrl,
            method,
            resourceType: req.resourceType(),
            status: null,
          });
        }
        req.continue().catch(() => {});
      } catch {
        req.abort("blockedbyclient").catch(() => {});
      }
    });

    page.on("response", (res) => {
      const existing = requests.get(res.url());
      if (existing) existing.status = res.status();
    });

    const navigation = await page.goto(target.href, {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_TIMEOUT_MS,
    });

    await sleep(RENDER_SETTLE_MS);
    await passiveScrollSweep(page);
    await sleep(250);

    const finalUrl = page.url();
    assertPublicUrl(new URL(finalUrl));

    const capture = await page.evaluate((sourceUrl) => {
      const uniq = (items) => [...new Set(items.filter(Boolean))];
      const abs = (value) => {
        try {
          return new URL(value, document.baseURI).href;
        } catch {
          return null;
        }
      };

      const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 250_000);
      const originalHtmlLength = document.documentElement?.outerHTML?.length || 0;
      const clone = document.documentElement.cloneNode(true);
      const stats = {
        removedScripts: 0,
        removedFrames: 0,
        transformedForms: 0,
        removedEventHandlers: 0,
        removedJavascriptUrls: 0,
        removedRefreshMeta: 0,
        removedResourceHints: 0,
        resolvedImages: 0,
        resolvedVideos: 0,
        canvasSnapshots: 0,
        suppressedLoaders: 0,
        unlockedScroll: true,
        passiveScrollSweep: true,
      };

      const liveImages = [...document.querySelectorAll("img")];
      const cloneImages = [...clone.querySelectorAll("img")];
      for (let i = 0; i < Math.min(liveImages.length, cloneImages.length); i += 1) {
        const live = liveImages[i];
        const copy = cloneImages[i];
        const src = live.currentSrc || live.src || live.getAttribute("data-src");
        const srcset = live.srcset || live.getAttribute("data-srcset");
        if (src && !src.startsWith("blob:")) {
          copy.setAttribute("src", src);
          stats.resolvedImages += 1;
        }
        if (srcset) copy.setAttribute("srcset", srcset);
        copy.removeAttribute("loading");
      }

      const liveVideos = [...document.querySelectorAll("video")];
      const cloneVideos = [...clone.querySelectorAll("video")];
      for (let i = 0; i < Math.min(liveVideos.length, cloneVideos.length); i += 1) {
        const live = liveVideos[i];
        const copy = cloneVideos[i];
        const src = live.currentSrc || live.src || live.getAttribute("data-src");
        if (src && !src.startsWith("blob:")) {
          copy.setAttribute("src", src);
          stats.resolvedVideos += 1;
        }
        if (live.poster) copy.setAttribute("poster", live.poster);
        copy.removeAttribute("autoplay");
        copy.removeAttribute("muted");
        copy.setAttribute("controls", "");
      }

      const liveCanvas = [...document.querySelectorAll("canvas")];
      const cloneCanvas = [...clone.querySelectorAll("canvas")];
      for (let i = 0; i < Math.min(liveCanvas.length, cloneCanvas.length, 6); i += 1) {
        try {
          const live = liveCanvas[i];
          if (!live.width || !live.height) continue;
          const data = live.toDataURL("image/png");
          if (!data || data.length > 450_000) continue;
          const image = document.createElement("img");
          image.setAttribute("src", data);
          image.setAttribute("alt", "Captured canvas snapshot");
          image.className = cloneCanvas[i].className || "";
          const style = cloneCanvas[i].getAttribute("style");
          if (style) image.setAttribute("style", style);
          image.setAttribute("width", String(live.width));
          image.setAttribute("height", String(live.height));
          cloneCanvas[i].replaceWith(image);
          stats.canvasSnapshots += 1;
        } catch {
          // Tainted or unsupported canvas; keep the inert canvas element.
        }
      }

      const removeAll = (selector, counter) => {
        for (const node of [...clone.querySelectorAll(selector)]) {
          stats[counter] += 1;
          node.remove();
        }
      };

      removeAll("script, noscript", "removedScripts");
      removeAll("iframe, frame, object, embed, portal", "removedFrames");

      for (const meta of [...clone.querySelectorAll("meta[http-equiv]")]) {
        const value = (meta.getAttribute("http-equiv") || "").toLowerCase();
        if (value === "refresh" || value === "content-security-policy") {
          if (value === "refresh") stats.removedRefreshMeta += 1;
          meta.remove();
        }
      }

      for (const link of [...clone.querySelectorAll("link[rel]")]) {
        const rel = (link.getAttribute("rel") || "").toLowerCase().split(/\s+/);
        if (rel.some((x) => ["preload", "prefetch", "prerender", "modulepreload", "manifest"].includes(x))) {
          stats.removedResourceHints += 1;
          link.remove();
        }
      }

      for (const form of [...clone.querySelectorAll("form")]) {
        const replacement = document.createElement("div");
        replacement.className = form.className;
        if (form.id) replacement.id = form.id;
        const style = form.getAttribute("style");
        if (style) replacement.setAttribute("style", style);
        while (form.firstChild) replacement.appendChild(form.firstChild);
        form.replaceWith(replacement);
        stats.transformedForms += 1;
      }

      for (const element of [...clone.querySelectorAll("*")]) {
        for (const attr of [...element.attributes]) {
          const name = attr.name.toLowerCase();
          const value = attr.value.trim();
          if (name.startsWith("on")) {
            element.removeAttribute(attr.name);
            stats.removedEventHandlers += 1;
            continue;
          }
          if (["srcdoc", "formaction", "action", "method"].includes(name)) {
            element.removeAttribute(attr.name);
            continue;
          }
          if (["href", "src", "xlink:href"].includes(name) && /^javascript:/i.test(value)) {
            element.removeAttribute(attr.name);
            stats.removedJavascriptUrls += 1;
          }
        }
        if (element.hasAttribute("contenteditable")) element.removeAttribute("contenteditable");
      }

      for (const anchor of [...clone.querySelectorAll("a[href]")]) {
        anchor.setAttribute("target", "_blank");
        anchor.setAttribute("rel", "noopener noreferrer");
      }

      const loaderPattern = /(?:^|[-_\s])(initial[-_\s]?loader|page[-_\s]?loader|site[-_\s]?loader|preloader|loading[-_\s]?overlay|splash[-_\s]?screen)(?:$|[-_\s])/i;
      for (const element of [...clone.querySelectorAll("body *")]) {
        const marker = `${element.getAttribute("id") || ""} ${element.getAttribute("class") || ""}`;
        if (loaderPattern.test(marker)) {
          element.remove();
          stats.suppressedLoaders += 1;
        }
      }

      const cloneBody = clone.querySelector("body");
      const cloneHtml = clone;
      const unlock = (element) => {
        if (!element) return;
        for (const token of ["loading", "is-loading", "no-scroll", "noscroll", "overflow-hidden"]) {
          element.classList?.remove(token);
        }
        element.style?.setProperty("overflow", "auto", "important");
        element.style?.setProperty("overflow-y", "auto", "important");
        element.style?.setProperty("height", "auto", "important");
      };
      unlock(cloneHtml);
      unlock(cloneBody);

      let head = clone.querySelector("head");
      if (!head) {
        head = document.createElement("head");
        clone.prepend(head);
      }

      for (const oldBase of [...head.querySelectorAll("base")]) oldBase.remove();
      const base = document.createElement("base");
      base.setAttribute("href", sourceUrl);
      head.prepend(base);

      const csp = document.createElement("meta");
      csp.setAttribute("http-equiv", "Content-Security-Policy");
      csp.setAttribute(
        "content",
        "default-src 'self' https: data: blob:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri https:; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; media-src https: data: blob:"
      );
      head.prepend(csp);

      const generator = document.createElement("meta");
      generator.setAttribute("name", "generator");
      generator.setAttribute("content", "Passive Fetch / Render Auditor - rendered snapshot v1.4");
      head.appendChild(generator);

      const compatibility = document.createElement("style");
      compatibility.id = "pfr-rendered-snapshot-compat";
      compatibility.textContent = `
        html,body{overflow:auto!important;overflow-y:auto!important;height:auto!important;min-height:100%!important;}
        body{opacity:1!important;visibility:visible!important;}
        #loader,#initial-loader,#page-loader,#site-loader,#preloader,
        .initial-loader,.page-loader,.site-loader,.preloader,.loading-overlay,.splash-screen,
        [id*="initial-loader"],[class*="initial-loader"]{display:none!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;}
        [data-aos],[data-reveal],[data-scroll-reveal],.reveal-on-scroll,.animate-on-scroll{opacity:1!important;visibility:visible!important;}
      `;
      head.appendChild(compatibility);

      const html = "<!doctype html>\n<!-- Rendered static reconstruction v1.4. Final post-JavaScript DOM captured during Deep Scan; executable scripts and active backend actions removed. -->\n" + clone.outerHTML;

      return {
        public: {
          title: document.title || "",
          text,
          htmlLength: originalHtmlLength,
          counts: {
            elements: document.getElementsByTagName("*").length,
            scripts: document.scripts.length,
            images: document.images.length,
            links: document.links.length,
            iframes: document.querySelectorAll("iframe").length,
            forms: document.forms.length,
          },
          scripts: uniq([...document.scripts].map((x) => abs(x.src))).slice(0, 80),
          images: uniq([...document.images].map((x) => abs(x.currentSrc || x.src))).slice(0, 80),
          links: uniq([...document.links].map((x) => abs(x.href))).slice(0, 80),
          generator: document.querySelector('meta[name="generator"]')?.content || "",
          description: document.querySelector('meta[name="description"]')?.content || "",
        },
        snapshot: {
          html,
          title: document.title || "",
          stats,
        },
      };
    }, finalUrl);

    const network = [...requests.values()];
    const durationMs = Date.now() - started;

    return {
      public: {
        ok: true,
        status: navigation?.status?.() ?? null,
        finalUrl,
        durationMs,
        title: capture.public.title,
        description: capture.public.description,
        generator: capture.public.generator,
        textLength: capture.public.text.length,
        textSample: capture.public.text.slice(0, 600),
        htmlLength: capture.public.htmlLength,
        counts: capture.public.counts,
        scripts: capture.public.scripts,
        images: capture.public.images,
        links: capture.public.links,
        network: {
          totalCaptured: network.length,
          byType: countBy(network, "resourceType"),
          requests: network,
          blockedRequests,
        },
      },
      snapshot: {
        ok: true,
        finalUrl,
        durationMs,
        title: capture.snapshot.title,
        html: capture.snapshot.html,
        stats: {
          ...capture.snapshot.stats,
          blockedWriteRequests: blockedRequests.length,
        },
      },
    };
  } catch (error) {
    const message = cleanError(error);
    return {
      public: {
        ok: false,
        error: message,
        durationMs: Date.now() - started,
        blockedRequests,
      },
      snapshot: { ok: false, error: message },
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}

async function passiveScrollSweep(page) {
  try {
    await page.evaluate(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const scroller = document.scrollingElement || document.documentElement;
      const maxY = Math.min(Math.max((scroller.scrollHeight || 0) - innerHeight, 0), 18_000);
      const step = Math.max(Math.floor(innerHeight * 0.8), 650);
      for (let y = 0; y <= maxY; y += step) {
        window.scrollTo(0, y);
        scroller.scrollTop = y;
        await wait(90);
      }
      window.scrollTo(0, maxY);
      scroller.scrollTop = maxY;
      await wait(180);
      window.scrollTo(0, 0);
      scroller.scrollTop = 0;
      if (document.fonts?.ready) {
        await Promise.race([document.fonts.ready, wait(900)]).catch(() => {});
      }
    });
  } catch {
    // Scroll sweep is best-effort only.
  }
}

function compareRawAndRendered(raw, rendered) {
  const similarity = tokenJaccard(raw?.textSample || "", rendered?.textSample || "");
  const rawAssetSet = new Set([
    ...(raw?.assets?.scripts || []),
    ...(raw?.assets?.stylesheets || []),
    ...(raw?.assets?.images || []),
  ]);
  const browserAssetSet = new Set([
    ...(rendered?.scripts || []),
    ...(rendered?.images || []),
    ...(rendered?.network?.requests || []).map((x) => x.url),
  ]);
  const browserOnlyAssets = [...browserAssetSet].filter((x) => !rawAssetSet.has(x)).slice(0, 60);

  return {
    textSimilarity: similarity,
    similarityMethod: "sample-token-jaccard-v14",
    rawTextLength: raw?.textLength || 0,
    renderedTextLength: rendered?.textLength || 0,
    textGrowth: (rendered?.textLength || 0) - (raw?.textLength || 0),
    rawHtmlLength: raw?.htmlLength || 0,
    renderedHtmlLength: rendered?.htmlLength || 0,
    htmlGrowth: (rendered?.htmlLength || 0) - (raw?.htmlLength || 0),
    browserOnlyAssets,
    browserOnlyAssetCount: [...browserAssetSet].filter((x) => !rawAssetSet.has(x)).length,
  };
}

function buildVerdict(raw, rendered, comparison) {
  if ([401, 403, 407, 429].includes(raw?.status)) {
    if (rendered?.ok) return { code: "BROWSER_ACCESS_DIFFERS", label: "Browser access differs from raw fetch", tone: "warning" };
    return { code: "ACCESS_RESTRICTED", label: "Access restricted", tone: "danger" };
  }
  if (!raw?.ok && (raw?.status || 0) >= 500) {
    return { code: "UPSTREAM_ERROR", label: "Upstream returned an error", tone: "danger" };
  }
  if (
    rendered?.ok && comparison &&
    (comparison.textGrowth > 1500 || comparison.browserOnlyAssetCount > 15) &&
    comparison.textSimilarity < 0.72
  ) {
    return { code: "JS_DEPENDENT", label: "Significant JavaScript-rendered content", tone: "warning" };
  }
  if ((raw?.status || 0) >= 200 && (raw?.status || 0) < 400 && (raw?.htmlLength || 0) > 300) {
    return { code: "FETCHABLE", label: "Raw HTML is fetchable", tone: "success" };
  }
  return { code: "LIMITED", label: "Limited fetchability", tone: "warning" };
}

function buildFetchabilityScore(raw, rendered) {
  let score = 0;
  if ((raw?.status || 0) >= 200 && (raw?.status || 0) < 400) score += 50;
  if ((raw?.htmlLength || 0) > 300) score += 20;
  if ((raw?.textLength || 0) > 200) score += 10;
  if ((raw?.assets?.scripts?.length || 0) + (raw?.assets?.images?.length || 0) > 0) score += 10;
  if (!rendered || rendered.ok) score += 10;
  if ([401, 403, 407, 429].includes(raw?.status)) score = Math.min(score, 25);
  return Math.max(0, Math.min(100, score));
}

function countBy(items, key) {
  const out = {};
  for (const item of items) {
    const value = item?.[key] || "unknown";
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

function tokenJaccard(a, b) {
  const tokenize = (value) => new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter((x) => x.length > 1)
      .slice(0, 20_000),
  );
  const left = tokenize(a);
  const right = tokenize(b);
  if (!left.size && !right.size) return 1;
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union ? intersection / union : 0;
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

function byteLength(value) {
  return new TextEncoder().encode(String(value || "")).byteLength;
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

function cleanError(error) {
  if (!error) return "Unknown error";
  const message = typeof error === "string" ? error : error.message || String(error);
  return message.slice(0, 500);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
