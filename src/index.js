import puppeteer from "@cloudflare/puppeteer";

const MAX_BODY_BYTES = 1_500_000;
const MAX_BUILD_HTML_BYTES = 2_500_000;
const MAX_ASSETS = 120;
const MAX_NETWORK = 120;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15_000;
const BROWSER_TIMEOUT_MS = 20_000;
const RENDER_SETTLE_MS = 1_200;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        service: "Passive Fetch / Render Auditor",
        browserRunConfigured: Boolean(env.BROWSER),
        accessKeyConfigured: Boolean(env.AUDIT_KEY),
        buildWebConfigured: Boolean(env.BROWSER),
        version: "1.1.0",
      });
    }

    if (url.pathname === "/api/scan" && request.method === "POST") {
      return handleScan(request, env);
    }

    if (url.pathname === "/api/build" && request.method === "POST") {
      return handleBuild(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleScan(request, env) {
  const authError = authorize(request, env);
  if (authError) return authError;

  const input = await readJsonBody(request);
  if (input instanceof Response) return input;

  const mode = input?.mode === "deep" ? "deep" : "quick";
  let target;
  try {
    target = normalizePublicUrl(input?.url);
  } catch (error) {
    return json({ error: error.message, code: "INVALID_TARGET" }, 400);
  }

  const startedAt = Date.now();

  try {
    const rawResult = await rawAudit(target);
    const raw = rawResult.public;
    let renderedResult = null;
    let rendered = null;

    if (mode === "deep") {
      if (!env.BROWSER) {
        rendered = {
          ok: false,
          error: "Cloudflare Browser Run binding is not available.",
        };
      } else {
        renderedResult = await browserAudit(target, env.BROWSER);
        rendered = renderedResult.public;
      }
    }

    const comparison = renderedResult?.public?.ok
      ? compareRawAndRendered(rawResult, renderedResult)
      : null;

    const verdict = buildVerdict(raw, rendered, comparison);
    const fetchabilityScore = buildFetchabilityScore(raw, rendered);

    return json({
      target: target.href,
      mode,
      scannedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      verdict,
      fetchabilityScore,
      raw,
      rendered,
      comparison,
      buildWeb: {
        available: Boolean(env.BROWSER),
        mode: "sanitized-static-reconstruction",
        note: "Build Web re-renders the public page, removes executable scripts, frames, form submission semantics and inline event handlers, then returns a static HTML reconstruction that may reference public remote assets.",
      },
      safety: {
        requestMethods: "GET/HEAD only",
        redirectsValidated: true,
        privateLiteralTargetsBlocked: true,
        responseBodyReturned: false,
        note: "Passive inspection only: no form submission, no clicks, no credential replay, and no custom request body to the target.",
      },
    });
  } catch (error) {
    return json(
      {
        target: target.href,
        mode,
        error: cleanError(error),
        durationMs: Date.now() - startedAt,
      },
      502,
    );
  }
}

async function handleBuild(request, env) {
  const authError = authorize(request, env);
  if (authError) return authError;

  if (!env.BROWSER) {
    return json(
      { error: "Cloudflare Browser Run binding is not available.", code: "BROWSER_MISSING" },
      503,
    );
  }

  const input = await readJsonBody(request);
  if (input instanceof Response) return input;

  let target;
  try {
    target = normalizePublicUrl(input?.url);
  } catch (error) {
    return json({ error: error.message, code: "INVALID_TARGET" }, 400);
  }

  const startedAt = Date.now();

  try {
    const built = await browserBuild(target, env.BROWSER);
    if (!built.ok) {
      return json(
        {
          target: target.href,
          error: built.error || "Unable to build static reconstruction",
          code: "BUILD_FAILED",
          durationMs: Date.now() - startedAt,
        },
        502,
      );
    }

    const htmlBytes = byteLength(built.html);
    if (htmlBytes > MAX_BUILD_HTML_BYTES) {
      return json(
        {
          target: target.href,
          error: `Sanitized reconstruction is too large (${htmlBytes} bytes). Limit is ${MAX_BUILD_HTML_BYTES} bytes.`,
          code: "BUILD_TOO_LARGE",
          stats: built.stats,
        },
        413,
      );
    }

    return json({
      ok: true,
      target: target.href,
      finalUrl: built.finalUrl,
      builtAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      mode: "sanitized-static-reconstruction",
      filename: safeFilename(built.title || new URL(built.finalUrl).hostname) + ".html",
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
      },
    });
  } catch (error) {
    return json(
      {
        target: target.href,
        error: cleanError(error),
        code: "BUILD_FAILED",
        durationMs: Date.now() - startedAt,
      },
      502,
    );
  }
}

function authorize(request, env) {
  if (!env.AUDIT_KEY) {
    return json(
      {
        error: "Server is not armed yet. Configure the AUDIT_KEY Worker secret first.",
        code: "AUDIT_KEY_MISSING",
      },
      503,
    );
  }

  const auth = request.headers.get("authorization") || "";
  const supplied = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!safeEqual(supplied, String(env.AUDIT_KEY))) {
    return json({ error: "Invalid access key", code: "UNAUTHORIZED" }, 401);
  }

  return null;
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return json({ error: "Body must be valid JSON" }, 400);
  }
}

async function rawAudit(target) {
  const started = Date.now();
  const result = await fetchWithValidatedRedirects(target);
  const response = result.response;
  const contentType = response.headers.get("content-type") || "";
  const isTextLike = /text|html|json|xml|javascript/i.test(contentType);
  const body = isTextLike ? await readTextLimited(response, MAX_BODY_BYTES) : "";
  const finalUrl = result.finalUrl.href;
  const analysis = analyzeHtml(body, finalUrl, response.headers);

  return {
    compareText: analysis.compareText,
    public: {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      finalUrl,
      redirects: result.redirects,
      durationMs: Date.now() - started,
      contentType,
      bodyBytesRead: byteLength(body),
      bodyTruncated: byteLength(body) >= MAX_BODY_BYTES,
      headers: pickHeaders(response.headers),
      securityHeaders: securityHeaderSummary(response.headers),
      ...analysis.public,
    },
  };
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
        "user-agent": "Passive-Fetch-Render-Auditor/1.1",
        dnt: "1",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!isRedirect(response.status)) {
      return { response, finalUrl: current, redirects };
    }

    const location = response.headers.get("location");
    if (!location) {
      return { response, finalUrl: current, redirects };
    }

    if (i === MAX_REDIRECTS) {
      throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
    }

    const next = new URL(location, current);
    assertPublicUrl(next);
    redirects.push({ status: response.status, from: current.href, to: next.href });
    current = next;
  }

  throw new Error("Redirect processing failed");
}

async function browserAudit(target, browserBinding) {
  const started = Date.now();
  let browser;
  const requests = new Map();
  const blockedRequests = [];

  try {
    browser = await puppeteer.launch(browserBinding);
    const page = await browser.newPage();
    await configurePassivePage(page, { requests, blockedRequests });

    const navigation = await page.goto(target.href, {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_TIMEOUT_MS,
    });

    await sleep(RENDER_SETTLE_MS);

    const finalUrl = page.url();
    assertPublicUrl(new URL(finalUrl));

    const dom = await page.evaluate(() => {
      const uniq = (items) => [...new Set(items.filter(Boolean))];
      const abs = (value) => {
        try {
          return new URL(value, document.baseURI).href;
        } catch {
          return null;
        }
      };
      const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 250_000);

      return {
        title: document.title || "",
        text,
        htmlLength: document.documentElement?.outerHTML?.length || 0,
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
      };
    });

    const network = [...requests.values()];

    return {
      compareText: dom.text,
      public: {
        ok: true,
        status: navigation?.status?.() ?? null,
        finalUrl,
        durationMs: Date.now() - started,
        title: dom.title,
        description: dom.description,
        generator: dom.generator,
        textLength: dom.text.length,
        textSample: dom.text.slice(0, 600),
        htmlLength: dom.htmlLength,
        counts: dom.counts,
        scripts: dom.scripts,
        images: dom.images,
        links: dom.links,
        network: {
          totalCaptured: network.length,
          byType: countBy(network, "resourceType"),
          requests: network,
          blockedRequests,
        },
      },
    };
  } catch (error) {
    return {
      compareText: "",
      public: {
        ok: false,
        error: cleanError(error),
        durationMs: Date.now() - started,
        blockedRequests,
      },
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

async function browserBuild(target, browserBinding) {
  let browser;
  const blockedRequests = [];

  try {
    browser = await puppeteer.launch(browserBinding);
    const page = await browser.newPage();
    await configurePassivePage(page, { blockedRequests });

    const navigation = await page.goto(target.href, {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_TIMEOUT_MS,
    });

    if (navigation && navigation.status() >= 400) {
      throw new Error(`Target returned HTTP ${navigation.status()}`);
    }

    await sleep(RENDER_SETTLE_MS);

    const finalUrl = page.url();
    assertPublicUrl(new URL(finalUrl));

    const result = await page.evaluate((sourceUrl) => {
      const stats = {
        removedScripts: 0,
        removedFrames: 0,
        transformedForms: 0,
        removedEventHandlers: 0,
        removedJavascriptUrls: 0,
        removedRefreshMeta: 0,
        removedResourceHints: 0,
      };

      const removeAll = (selector, counter) => {
        for (const node of [...document.querySelectorAll(selector)]) {
          stats[counter] += 1;
          node.remove();
        }
      };

      removeAll("script, noscript", "removedScripts");
      removeAll("iframe, frame, object, embed, portal", "removedFrames");

      for (const meta of [...document.querySelectorAll("meta[http-equiv]")]) {
        const value = (meta.getAttribute("http-equiv") || "").toLowerCase();
        if (value === "refresh" || value === "content-security-policy") {
          if (value === "refresh") stats.removedRefreshMeta += 1;
          meta.remove();
        }
      }

      for (const link of [...document.querySelectorAll("link[rel]")]) {
        const rel = (link.getAttribute("rel") || "").toLowerCase().split(/\s+/);
        if (rel.some((x) => ["preload", "prefetch", "prerender", "modulepreload", "manifest"].includes(x))) {
          stats.removedResourceHints += 1;
          link.remove();
        }
      }

      for (const form of [...document.forms]) {
        const replacement = document.createElement("div");
        replacement.className = form.className;
        if (form.id) replacement.id = form.id;
        const style = form.getAttribute("style");
        if (style) replacement.setAttribute("style", style);
        while (form.firstChild) replacement.appendChild(form.firstChild);
        form.replaceWith(replacement);
        stats.transformedForms += 1;
      }

      for (const element of [...document.querySelectorAll("*")]) {
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

        if (element.hasAttribute("contenteditable")) {
          element.removeAttribute("contenteditable");
        }
      }

      for (const anchor of [...document.querySelectorAll("a[href]")]) {
        anchor.setAttribute("target", "_blank");
        anchor.setAttribute("rel", "noopener noreferrer");
      }

      let base = document.querySelector("base");
      if (!base) {
        base = document.createElement("base");
        document.head.prepend(base);
      }
      base.setAttribute("href", sourceUrl);

      const csp = document.createElement("meta");
      csp.setAttribute("http-equiv", "Content-Security-Policy");
      csp.setAttribute(
        "content",
        "default-src 'self' https: data: blob:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri https:; style-src 'unsafe-inline' https:; img-src https: data: blob:; font-src https: data:; media-src https: data: blob:"
      );
      document.head.prepend(csp);

      const generator = document.createElement("meta");
      generator.setAttribute("name", "generator");
      generator.setAttribute("content", "Passive Fetch / Render Auditor - sanitized static reconstruction");
      document.head.appendChild(generator);

      const html = "<!doctype html>\n<!-- Sanitized static reconstruction generated from a public rendered page. Executable scripts, frames, form submission semantics and inline event handlers were removed. -->\n" + document.documentElement.outerHTML;

      return {
        html,
        title: document.title || "",
        stats,
      };
    }, finalUrl);

    return {
      ok: true,
      finalUrl,
      title: result.title,
      html: result.html,
      stats: {
        ...result.stats,
        blockedWriteRequests: blockedRequests.length,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: cleanError(error),
      stats: { blockedWriteRequests: blockedRequests.length },
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

async function configurePassivePage(page, { requests = null, blockedRequests = [] } = {}) {
  page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS);
  await page.setViewport({ width: 1365, height: 900, deviceScaleFactor: 1 });
  await page.setUserAgent("Passive-Fetch-Render-Auditor/1.1 (Cloudflare Browser Run)");
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

      if (requests && requests.size < MAX_NETWORK) {
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

  if (requests) {
    page.on("response", (res) => {
      const existing = requests.get(res.url());
      if (existing) existing.status = res.status();
    });
  }
}

function analyzeHtml(html, baseUrl, headers) {
  const title = firstMatch(html, /<title[^>]*>([\s\S]{0,500}?)<\/title>/i);
  const description = firstMatch(
    html,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,1000})["'][^>]*>/i,
  ) || firstMatch(
    html,
    /<meta[^>]+content=["']([^"']{0,1000})["'][^>]+name=["']description["'][^>]*>/i,
  );
  const generator = firstMatch(
    html,
    /<meta[^>]+name=["']generator["'][^>]+content=["']([^"']{0,500})["'][^>]*>/i,
  );

  const scripts = uniqueUrls(
    collectMatches(html, /<script[^>]+src=["']([^"']+)["'][^>]*>/gi),
    baseUrl,
  ).slice(0, MAX_ASSETS);

  const stylesheetCandidates = [
    ...collectMatches(html, /<link[^>]+rel=["'][^"']*stylesheet[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/gi),
    ...collectMatches(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi),
  ];
  const stylesheets = uniqueUrls(stylesheetCandidates, baseUrl).slice(0, MAX_ASSETS);

  const imageCandidates = [
    ...collectMatches(html, /<img[^>]+src=["']([^"']+)["'][^>]*>/gi),
    ...collectMatches(html, /<source[^>]+src=["']([^"']+)["'][^>]*>/gi),
  ];
  const images = uniqueUrls(imageCandidates, baseUrl).slice(0, MAX_ASSETS);

  const links = uniqueUrls(
    collectMatches(html, /<a[^>]+href=["']([^"']+)["'][^>]*>/gi),
    baseUrl,
  ).slice(0, MAX_ASSETS);

  const text = htmlToText(html).slice(0, 250_000);
  const apiHints = discoverApiHints(html, baseUrl);
  const technologies = fingerprintTechnologies(html, headers);

  return {
    compareText: text,
    public: {
      title: decodeEntities(title).trim(),
      description: decodeEntities(description).trim(),
      generator: decodeEntities(generator).trim(),
      htmlLength: html.length,
      textLength: text.length,
      textSample: text.slice(0, 600),
      counts: {
        scripts: scripts.length,
        stylesheets: stylesheets.length,
        images: images.length,
        links: links.length,
        forms: countMatches(html, /<form\b/gi),
        iframes: countMatches(html, /<iframe\b/gi),
      },
      assets: { scripts, stylesheets, images },
      links,
      apiHints,
      technologies,
    },
  };
}

function compareRawAndRendered(rawResult, renderedResult) {
  const raw = rawResult.public;
  const rendered = renderedResult.public;
  const similarity = tokenJaccard(rawResult.compareText, renderedResult.compareText);
  const rawAssetSet = new Set([
    ...(raw.assets?.scripts || []),
    ...(raw.assets?.stylesheets || []),
    ...(raw.assets?.images || []),
  ]);
  const browserAssetSet = new Set([
    ...(rendered.scripts || []),
    ...(rendered.images || []),
    ...(rendered.network?.requests || []).map((x) => x.url),
  ]);
  const browserOnlyAssets = [...browserAssetSet].filter((x) => !rawAssetSet.has(x)).slice(0, 60);

  return {
    textSimilarity: similarity,
    similarityMethod: "normalized-visible-text-token-jaccard",
    rawTextLength: raw.textLength,
    renderedTextLength: rendered.textLength,
    textGrowth: rendered.textLength - raw.textLength,
    rawHtmlLength: raw.htmlLength,
    renderedHtmlLength: rendered.htmlLength,
    htmlGrowth: rendered.htmlLength - raw.htmlLength,
    browserOnlyAssets,
    browserOnlyAssetCount: [...browserAssetSet].filter((x) => !rawAssetSet.has(x)).length,
  };
}

function buildVerdict(raw, rendered, comparison) {
  if ([401, 403, 407, 429].includes(raw.status)) {
    if (rendered?.ok) {
      return {
        code: "BROWSER_ACCESS_DIFFERS",
        label: "Browser access differs from raw fetch",
        tone: "warning",
      };
    }
    return { code: "ACCESS_RESTRICTED", label: "Access restricted", tone: "danger" };
  }

  if (!raw.ok && raw.status >= 500) {
    return { code: "UPSTREAM_ERROR", label: "Upstream returned an error", tone: "danger" };
  }

  if (
    rendered?.ok &&
    comparison &&
    (comparison.textGrowth > 1500 || comparison.browserOnlyAssetCount > 15) &&
    comparison.textSimilarity < 0.72
  ) {
    return { code: "JS_DEPENDENT", label: "Significant JavaScript-rendered content", tone: "warning" };
  }

  if (raw.status >= 200 && raw.status < 400 && raw.htmlLength > 300) {
    return { code: "FETCHABLE", label: "Raw HTML is fetchable", tone: "success" };
  }

  return { code: "LIMITED", label: "Limited fetchability", tone: "warning" };
}

function buildFetchabilityScore(raw, rendered) {
  let score = 0;
  if (raw.status >= 200 && raw.status < 400) score += 50;
  if (raw.htmlLength > 300) score += 20;
  if (raw.textLength > 200) score += 10;
  if ((raw.assets?.scripts?.length || 0) + (raw.assets?.images?.length || 0) > 0) score += 10;
  if (!rendered || rendered.ok) score += 10;
  if ([401, 403, 407, 429].includes(raw.status)) score = Math.min(score, 25);
  return Math.max(0, Math.min(100, score));
}

function fingerprintTechnologies(html, headers) {
  const lower = html.toLowerCase();
  const server = (headers.get("server") || "").toLowerCase();
  const powered = (headers.get("x-powered-by") || "").toLowerCase();
  const out = [];
  const add = (name, evidence) => {
    if (!out.some((x) => x.name === name)) out.push({ name, evidence });
  };

  if (/wp-content|wp-includes|wp-json|wordpress/.test(lower)) add("WordPress", "HTML paths / metadata");
  if (/woocommerce/.test(lower)) add("WooCommerce", "HTML assets / classes");
  if (/shopify|cdn\.shopify\.com/.test(lower)) add("Shopify", "HTML assets / metadata");
  if (/__next|_next\//.test(lower)) add("Next.js", "Next.js markers");
  if (/data-reactroot|react-dom|react\.production/.test(lower)) add("React", "React markers");
  if (/nuxt|__nuxt/.test(lower)) add("Nuxt", "Nuxt markers");
  if (/cloudflare/.test(server) || headers.get("cf-ray")) add("Cloudflare", "Response headers");
  if (powered.includes("php")) add("PHP", "X-Powered-By header");
  if (server.includes("nginx")) add("nginx", "Server header");
  if (server.includes("apache")) add("Apache", "Server header");

  return out.slice(0, 20);
}

function discoverApiHints(html, baseUrl) {
  const raw = collectMatches(
    html,
    /["']((?:https?:\/\/[^"'\s<>]+|\/[^"'\s<>]*)(?:\/wp-json\/|\/api\/|graphql|admin-ajax\.php|\/ajax\/)[^"'\s<>]*)["']/gi,
  );
  return uniqueUrls(raw, baseUrl).slice(0, 60);
}

function securityHeaderSummary(headers) {
  const names = [
    "content-security-policy",
    "strict-transport-security",
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
    "permissions-policy",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
  ];
  return Object.fromEntries(names.map((name) => [name, headers.get(name) || ""]));
}

function pickHeaders(headers) {
  const names = [
    "server",
    "content-type",
    "content-length",
    "cache-control",
    "etag",
    "last-modified",
    "cf-ray",
    "cf-cache-status",
    "x-powered-by",
    "via",
  ];
  const out = {};
  for (const name of names) {
    const value = headers.get(name);
    if (value) out[name] = value;
  }
  return out;
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
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

function uniqueUrls(items, baseUrl) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    try {
      const url = new URL(decodeEntities(item), baseUrl);
      if (!/^https?:$/.test(url.protocol)) continue;
      const href = url.href;
      if (!seen.has(href)) {
        seen.add(href);
        out.push(href);
      }
    } catch {
      // Ignore malformed URLs.
    }
  }
  return out;
}

function collectMatches(text, regex) {
  const out = [];
  for (const match of text.matchAll(regex)) {
    if (match[1]) out.push(match[1]);
    if (out.length >= MAX_ASSETS * 3) break;
  }
  return out;
}

function firstMatch(text, regex) {
  return text.match(regex)?.[1] || "";
}

function countMatches(text, regex) {
  return [...text.matchAll(regex)].length;
}

function countBy(items, key) {
  const out = {};
  for (const item of items) {
    const value = item?.[key] || "unknown";
    out[value] = (out[value] || 0) + 1;
  }
  return out;
}

function normalizePublicUrl(input) {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("A public URL is required.");
  }
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
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;

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

async function readTextLimited(response, limit) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let out = "";

  try {
    while (bytes < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - bytes;
      const chunk = value.byteLength > remaining ? value.slice(0, remaining) : value;
      bytes += chunk.byteLength;
      out += decoder.decode(chunk, { stream: bytes < limit });
      if (value.byteLength > chunk.byteLength) break;
    }
    out += decoder.decode();
    return out;
  } finally {
    reader.releaseLock();
  }
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num) || 32))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16) || 32));
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
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

function safeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
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
