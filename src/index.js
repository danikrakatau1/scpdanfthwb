import puppeteer from "@cloudflare/puppeteer";

const MAX_BODY_BYTES = 1_500_000;
const MAX_ASSETS = 120;
const MAX_NETWORK = 120;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15_000;
const BROWSER_TIMEOUT_MS = 20_000;

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
        version: "1.0.0",
      });
    }

    if (url.pathname === "/api/scan" && request.method === "POST") {
      return handleScan(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleScan(request, env) {
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

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: "Body must be valid JSON" }, 400);
  }

  const mode = input?.mode === "deep" ? "deep" : "quick";
  let target;
  try {
    target = normalizePublicUrl(input?.url);
  } catch (error) {
    return json({ error: error.message, code: "INVALID_TARGET" }, 400);
  }

  const startedAt = Date.now();

  try {
    const raw = await rawAudit(target);
    let rendered = null;

    if (mode === "deep") {
      if (!env.BROWSER) {
        rendered = {
          ok: false,
          error: "Cloudflare Browser Run binding is not available.",
        };
      } else {
        rendered = await browserAudit(target, env.BROWSER);
      }
    }

    const comparison = rendered?.ok
      ? compareRawAndRendered(raw, rendered)
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
      safety: {
        requestMethods: "GET/HEAD only",
        redirectsValidated: true,
        privateLiteralTargetsBlocked: true,
        responseBodyReturned: false,
        note: "This tool is designed for passive inspection of public web pages. It does not submit forms, click controls, send custom target headers, or return full response bodies.",
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
    ...analysis,
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
        "user-agent": "Passive-Fetch-Render-Auditor/1.0",
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
    page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS);
    await page.setViewport({ width: 1365, height: 900, deviceScaleFactor: 1 });
    await page.setUserAgent("Passive-Fetch-Render-Auditor/1.0 (Cloudflare Browser Run)");
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

    await new Promise((resolve) => setTimeout(resolve, 1200));

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

      return {
        title: document.title || "",
        text: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 250_000),
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
    const text = dom.text;

    return {
      ok: true,
      status: navigation?.status?.() ?? null,
      finalUrl,
      durationMs: Date.now() - started,
      title: dom.title,
      description: dom.description,
      generator: dom.generator,
      textLength: text.length,
      textSample: text.slice(0, 600),
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
    };
  } catch (error) {
    return {
      ok: false,
      error: cleanError(error),
      durationMs: Date.now() - started,
      blockedRequests,
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

  const stylesheets = uniqueUrls(
    collectMatches(html, /<link[^>]+href=["']([^"']+)["'][^>]*>/gi),
    baseUrl,
  ).filter((x) => /\.css(?:[?#]|$)|stylesheet/i.test(x)).slice(0, MAX_ASSETS);

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
  };
}

function compareRawAndRendered(raw, rendered) {
  const rawText = raw.textSample || "";
  const renderedText = rendered.textSample || "";
  const similarity = tokenJaccard(rawText, renderedText);
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

  return { code: "LIMITED", label: "Limited fetch result", tone: "neutral" };
}

function buildFetchabilityScore(raw, rendered) {
  let score = 0;
  if (raw.status >= 200 && raw.status < 300) score += 45;
  if (raw.htmlLength > 1000) score += 20;
  if (raw.textLength > 500) score += 15;
  if ((raw.counts?.scripts || 0) + (raw.counts?.images || 0) > 0) score += 10;
  if (rendered?.ok) score += 10;
  return Math.max(0, Math.min(100, score));
}

function fingerprintTechnologies(html, headers) {
  const found = [];
  const add = (name, evidence) => {
    if (!found.some((x) => x.name === name)) found.push({ name, evidence });
  };

  if (/wp-content|wp-includes|wp-json|wordpress/i.test(html)) add("WordPress", "HTML paths / metadata");
  if (/_next\/static|__NEXT_DATA__/i.test(html)) add("Next.js", "_next / __NEXT_DATA__ markers");
  if (/__NUXT__|\/_nuxt\//i.test(html)) add("Nuxt", "Nuxt runtime markers");
  if (/data-reactroot|react-dom|react\.production/i.test(html)) add("React", "React runtime markers");
  if (/cdn\.shopify\.com|Shopify\.theme/i.test(html)) add("Shopify", "Shopify asset markers");
  if (/wixstatic\.com|X-Wix/i.test(html)) add("Wix", "Wix asset markers");
  if (/squarespace\.com|static1\.squarespace/i.test(html)) add("Squarespace", "Squarespace asset markers");
  if (/cloudflare/i.test(headers.get("server") || "") || headers.get("cf-ray")) add("Cloudflare", "Response headers");
  if (/vercel/i.test(headers.get("server") || "") || headers.get("x-vercel-id")) add("Vercel", "Response headers");

  return found;
}

function discoverApiHints(html, baseUrl) {
  const patterns = [
    /["']([^"']*\/wp-json\/[^"']*)["']/gi,
    /["']([^"']*\/api\/[^"']*)["']/gi,
    /["']([^"']*\/graphql[^"']*)["']/gi,
    /["']([^"']*admin-ajax\.php[^"']*)["']/gi,
  ];
  const all = patterns.flatMap((re) => collectMatches(html, re));
  return uniqueUrls(all, baseUrl).slice(0, 40);
}

function securityHeaderSummary(headers) {
  const names = [
    "content-security-policy",
    "strict-transport-security",
    "x-frame-options",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
  ];
  return Object.fromEntries(names.map((name) => [name, headers.get(name) || null]));
}

function pickHeaders(headers) {
  const allow = [
    "server",
    "content-type",
    "content-length",
    "cache-control",
    "etag",
    "last-modified",
    "vary",
    "cf-ray",
    "cf-cache-status",
    "x-vercel-id",
    "x-powered-by",
  ];
  return Object.fromEntries(allow.map((name) => [name, headers.get(name)]).filter(([, value]) => value));
}

function normalizePublicUrl(value) {
  if (typeof value !== "string" || value.trim().length < 4) {
    throw new Error("Enter a valid public URL");
  }
  const normalized = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
  const url = new URL(normalized);
  assertPublicUrl(url);
  url.hash = "";
  return url;
}

function assertPublicUrl(url) {
  if (!isSafePublicUrl(url)) {
    throw new Error("Only public http/https targets are allowed");
  }
}

function isSafePublicUrl(url) {
  if (!(url instanceof URL)) return false;
  if (!["http:", "https:"].includes(url.protocol)) return false;
  if (url.username || url.password) return false;

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname) return false;

  const blockedNames = [
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
    "metadata",
  ];
  if (blockedNames.includes(hostname)) return false;
  if (/\.(localhost|local|internal|home\.arpa)$/i.test(hostname)) return false;

  if (isIPv4(hostname)) return !isBlockedIPv4(hostname);
  if (hostname.includes(":")) return !isBlockedIPv6(hostname);
  return true;
}

function isIPv4(host) {
  const parts = host.split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function isBlockedIPv4(host) {
  const [a, b] = host.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIPv6(host) {
  const h = host.toLowerCase();
  if (h === "::" || h === "::1") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(h)) return true;
  if (h.startsWith("ff")) return true;
  if (h.startsWith("2001:db8")) return true;
  if (h.startsWith("::ffff:")) {
    const mapped = h.slice(7);
    if (isIPv4(mapped)) return isBlockedIPv4(mapped);
  }
  return false;
}

async function readTextLimited(response, limit) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        const allowed = Math.max(0, value.byteLength - (total - limit));
        out += decoder.decode(value.slice(0, allowed), { stream: true });
        await reader.cancel();
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return out;
  } finally {
    reader.releaseLock();
  }
}

function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeEntities(value = "") {
  return String(value)
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

function collectMatches(text, regex) {
  const results = [];
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) && results.length < 300) {
    results.push(match[1]);
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
  }
  return results;
}

function countMatches(text, regex) {
  regex.lastIndex = 0;
  let count = 0;
  while (regex.exec(text) && count < 10_000) count += 1;
  return count;
}

function firstMatch(text, regex) {
  const match = regex.exec(text);
  return match?.[1] || "";
}

function uniqueUrls(values, baseUrl) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    try {
      const url = new URL(decodeEntities(value), baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) continue;
      url.hash = "";
      const key = url.href;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    } catch {
      // Ignore malformed URLs discovered in markup.
    }
  }
  return out;
}

function tokenJaccard(a, b) {
  const tokenize = (value) => new Set(
    value.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((x) => x.length > 2).slice(0, 5000),
  );
  const left = tokenize(a);
  const right = tokenize(b);
  if (!left.size && !right.size) return 1;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = new Set([...left, ...right]).size || 1;
  return Number((intersection / union).toFixed(3));
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function cleanError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 500);
}

function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}
