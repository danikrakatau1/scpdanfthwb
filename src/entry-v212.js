import app from "./entry-v211.js";

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
        buildWebMode: "v2.1.2-boundary-typography-polish + v2.1.1-structural-fidelity + v2.1-block-aware + v2.0-legacy + v1-static-snapshot",
        cleanReconstructionEngine: true,
        blockAwareReconstruction: true,
        structuralFidelityPass: true,
        boundaryTypographyPolish: true,
        exactMembershipBoundaryRecovery: true,
        typographyFallbackCalibration: true,
        fontFilesCopied: false,
        fontAvailabilityAsserted: false,
        headerLogoRecovery: true,
        primaryNavigationRecovery: true,
        encountersComponentRecovery: true,
        membershipBoundaryGuard: true,
        fontTokenRecovery: true,
        cleanReconstructionUsesTargetScripts: false,
        cleanReconstructionUsesTargetCssAsLayout: false,
        cleanReconstructionBrowserQuotaUsed: false,
        boundarySourceRefetch: true,
        v211BaseEngine: "2.1.1",
        v21BaseEngine: "2.1.0",
        v2LegacyEngine: "2.0.2",
        v1CompatibilityEngine: "1.6.3",
        version: "2.1.2",
      });
    }

    if (url.pathname === "/api/build-v2" && request.method === "POST") {
      return handleBuildV212(request, env, ctx);
    }

    return app.fetch(request, env, ctx);
  },
};

async function handleBuildV212(request, env, ctx) {
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

  const source = await refetchPublicHtml(payload.finalUrl || payload.target);
  let html = String(payload.html || "");
  let membershipAssets = [];
  let typography = null;
  let boundaryApplied = false;
  let typographyApplied = false;

  if (source) {
    membershipAssets = extractMembershipAssetsBounded(source, payload.finalUrl || payload.target);
    if (membershipAssets.length) {
      const next = replaceMembershipSection(html, membershipAssets);
      if (next !== html) {
        html = next;
        boundaryApplied = true;
      }
    }

    typography = extractTypographyProfile(source);
    const next = injectTypographyCalibration(html, typography);
    if (next !== html) {
      html = next;
      typographyApplied = true;
    }
  }

  html = html
    .replace(/Structural Fidelity Reconstruction V2\.1\.1/g, "Boundary & Typography Reconstruction V2.1.2")
    .replace(/Structural-fidelity clean reconstruction from public page content\./g, "Boundary-safe structural reconstruction from public page content.");

  const integrity = validateStructure(html, payload, membershipAssets.length);

  return json({
    ...payload,
    engine: "v2.1.2-boundary-typography-reconstruction",
    mode: "clean-reconstruction-v212",
    filename: String(payload.filename || "clean-v211.html")
      .replace(/-clean-v211\.html$/i, "-clean-v212.html")
      .replace(/-clean-v21\.html$/i, "-clean-v212.html"),
    html,
    htmlBytes: byteLength(html),
    stats: {
      ...(payload.stats || {}),
      boundarySourceRefetchUsed: Boolean(source),
      membershipBoundaryExact: boundaryApplied,
      membershipAssetsRecovered: membershipAssets.length || payload.stats?.membershipAssetsRecovered || 0,
      typographyFallbackCalibrated: typographyApplied,
      fontFamilyTokensRecovered: Boolean(typography?.serif && typography?.sans),
      fontFilesCopied: 0,
      fontAvailabilityAsserted: false,
      mainNavigationItemsValidated: integrity.mainNavigationItems,
      journeysItemsValidated: integrity.journeysItems,
      encounterItemsValidated: integrity.encounterItems,
      membershipItemsValidated: integrity.membershipItems,
      headerLogoValidated: integrity.headerLogo,
      structuralLockReady: integrity.ready,
    },
    model: {
      ...(payload.model || {}),
      typography: typography ? {
        serif: typography.serif,
        sans: typography.sans,
        bodyDesktop: typography.bodyDesktop,
        bodyMobile: typography.bodyMobile,
        h1Desktop: typography.h1Desktop,
        h1Mobile: typography.h1Mobile,
        h2Desktop: typography.h2Desktop,
        h2Mobile: typography.h2Mobile,
        fontFilesCopied: 0,
        fontAvailabilityAsserted: false,
      } : null,
      structuralValidation: integrity,
    },
    safety: {
      ...(payload.safety || {}),
      targetScriptsCopied: false,
      targetJavaScriptExecutedByBuild: false,
      targetCssUsedAsLayoutFoundation: false,
      targetFontFilesCopied: false,
      typographyUsesRecoveredNamesWithCalibratedFallbacks: true,
      publicMarkupBoundaryParsingOnly: true,
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
        "user-agent": "Passive-Fetch-Render-Auditor/2.1.2 Boundary-Typography",
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

function extractMembershipAssetsBounded(source, baseHref) {
  const open = /<div\b[^>]*class=["'][^"']*\bmemberships-slider\b[^"']*["'][^>]*>/i.exec(source);
  if (!open) return [];
  const chunk = extractBalancedDiv(source, open.index);
  if (!chunk) return [];

  const out = [];
  const re = /<img\b([^>]*)>/gi;
  let match;
  while ((match = re.exec(chunk)) && out.length < 40) {
    const src = resolvePublicUrl(attr(match[1], "src") || attr(match[1], "data-src"), baseHref);
    if (!src || /map|favicon|icon|loader|spinner|complaint|livro|pixel|tracking/i.test(src)) continue;
    if (!out.includes(src)) out.push(src);
  }
  return out;
}

function extractBalancedDiv(source, startIndex) {
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = startIndex;
  let depth = 0;
  let started = false;
  let match;
  while ((match = re.exec(source))) {
    const token = match[0];
    const closing = /^<\/div/i.test(token);
    const selfClosing = /\/\s*>$/.test(token);
    if (!closing) {
      depth += 1;
      started = true;
      if (selfClosing) depth -= 1;
    } else if (started) {
      depth -= 1;
    }
    if (started && depth === 0) return source.slice(startIndex, re.lastIndex);
  }
  return "";
}

function replaceMembershipSection(html, assets) {
  const section = `<section class="section reveal memberships-section"><div class="section-inner"><h2>Memberships</h2><div class="partners">${assets.map((url) => `<div class="partner"><img loading="lazy" src="${escAttr(url)}" alt=""></div>`).join("")}</div></div></section>`;
  return html.replace(/<section\b[^>]*\bmemberships-section\b[^>]*>[\s\S]*?<\/section>/i, section);
}

function extractTypographyProfile(source) {
  const serif = cleanFontStack(first(source, /--wp--preset--font-family--vera-humana-95\s*:\s*([^;]+);/i))
    || '"Vera Humana 95", Helvetica, Tahoma, sans-serif';
  const sans = cleanFontStack(first(source, /--wp--preset--font-family--gotham\s*:\s*([^;]+);/i))
    || '"Gotham", Helvetica, Tahoma, sans-serif';

  const bodyDesktop = cleanCssSize(first(source, /--wp--preset--font-size--regular\s*:\s*([^;]+);/i)) || "16px";
  const h1Desktop = cleanCssSize(first(source, /--wp--preset--font-size--huge\s*:\s*([^;]+);/i)) || "84px";
  const h2Desktop = cleanCssSize(first(source, /--wp--preset--font-size--extra-large\s*:\s*([^;]+);/i)) || "60px";

  const bodyMobile = cleanCssSize(first(source, /@media\s+screen\s+and\s*\(max-width:600px\)\s*\{body\{--wp--preset--font-size--regular:([^;}]+)[;}]/i)) || "0.875rem";
  const h1Mobile = cleanCssSize(first(source, /@media\s+screen\s+and\s*\(max-width:600px\)\s*\{body\{--wp--preset--font-size--huge:([^;}]+)[;}]/i)) || "3.625rem";
  const h2Mobile = cleanCssSize(first(source, /@media\s+screen\s+and\s*\(max-width:600px\)\s*\{body\{--wp--preset--font-size--extra-large:([^;}]+)[;}]/i)) || "2.678125rem";

  return { serif, sans, bodyDesktop, bodyMobile, h1Desktop, h1Mobile, h2Desktop, h2Mobile };
}

function injectTypographyCalibration(html, profile) {
  if (!profile || html.includes("pfr-v212-typography")) return html;
  const css = `<style id="pfr-v212-typography">
:root{--pfr-serif:${profile.serif};--pfr-sans:${profile.sans};--pfr-body-desktop:${profile.bodyDesktop};--pfr-h1-desktop:${profile.h1Desktop};--pfr-h2-desktop:${profile.h2Desktop};--pfr-body-mobile:${profile.bodyMobile};--pfr-h1-mobile:${profile.h1Mobile};--pfr-h2-mobile:${profile.h2Mobile}}
body{font-family:var(--pfr-sans);font-size:var(--pfr-body-desktop);font-synthesis:none;letter-spacing:0}.hero h1,.section h2,.brand-text,.menu-grid a,.encounter-tab,.quote blockquote{font-family:var(--pfr-serif);font-synthesis:none}.hero h1{font-size:var(--pfr-h1-desktop)!important;line-height:1.05!important;letter-spacing:0!important}.section h2{font-size:var(--pfr-h2-desktop)!important;line-height:1.05!important;letter-spacing:0!important}
@media(max-width:600px){body{font-size:var(--pfr-body-mobile)}.hero h1{font-size:var(--pfr-h1-mobile)!important}.section h2{font-size:var(--pfr-h2-mobile)!important}}
</style>`;
  return html.replace(/<\/head>/i, `${css}</head>`);
}

function validateStructure(html, payload, expectedMemberships) {
  const headerLogo = /<header\b[^>]*class="topbar"[\s\S]*?<a\b[^>]*class="brand"[^>]*>[\s\S]*?<svg\b/i.test(html);
  const mainNavigationItems = countAnchors(extractTag(html, "nav", "menu-grid"));
  const journeysItems = countAnchors(extractTag(html, "nav", "journeys-menu"));
  const encounterItems = (html.match(/class="encounter-tab(?:\s+active)?"/g) || []).length;
  const membershipItems = (extractSection(html, "memberships-section").match(/class="partner"/g) || []).length;
  const expectedEncounters = Number(payload.stats?.encounterItemsRecovered || 0);
  const expectedJourneys = Number(payload.stats?.journeysDetected || 0);
  const ready = Boolean(
    headerLogo &&
    mainNavigationItems >= 3 &&
    (!expectedJourneys || journeysItems === expectedJourneys) &&
    (!expectedEncounters || encounterItems === expectedEncounters) &&
    (!expectedMemberships || membershipItems === expectedMemberships)
  );
  return { headerLogo, mainNavigationItems, journeysItems, encounterItems, membershipItems, expectedMemberships, ready };
}

function extractTag(html, tag, className) {
  const re = new RegExp(`<${tag}\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>[\\s\\S]*?<\\/${tag}>`, "i");
  return html.match(re)?.[0] || "";
}
function extractSection(html, className) {
  const re = new RegExp(`<section\\b[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>[\\s\\S]*?<\\/section>`, "i");
  return html.match(re)?.[0] || "";
}
function countAnchors(value) { return (String(value || "").match(/<a\b/gi) || []).length; }
function first(text, re) { return String(text || "").match(re)?.[1] || ""; }
function cleanFontStack(value) {
  const text = String(value || "").trim();
  return !text || /[{}<>;]|url\s*\(|expression\s*\(/i.test(text) ? "" : text.slice(0, 220);
}
function cleanCssSize(value) {
  const text = String(value || "").trim();
  return /^(?:\d*\.?\d+)(?:px|rem|em|vw|vh|svh|%)$/i.test(text) ? text : "";
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
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
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
function esc(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function escAttr(value) { return esc(value).replace(/`/g, "&#96;"); }
function byteLength(value) { return new TextEncoder().encode(String(value || "")).byteLength; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS }); }
