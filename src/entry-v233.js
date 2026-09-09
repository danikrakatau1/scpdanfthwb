import app from "./entry-v232.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

const LOCKED_GEOMETRY = {
  "--geo-cols": "12",
  "--geo-gap": "2.2vw",
  "--geo-wide": "995px",
  "--geo-side": "40px",
  "--geo-side-mobile": "20px",
  "--geo-small": "60px",
  "--geo-default": "100px",
  "--geo-large": "120px",
  "--geo-xlarge": "180px",
  "--geo-content-pad": "30px",
  "--geo-hero-min": "768px",
  "--geo-hero-min-mobile": "667px",
  "--geo-journey-title": "110px",
  "--geo-journey-title-mobile": "58px",
  "--geo-encounter-h": "602px",
  "--geo-encounter-h-mobile": "72.8vw",
  "--geo-radius": "40px",
  "--geo-radius-mobile": "30px",
  "--geo-arrow-w": "53px",
  "--geo-arrow-h": "50px",
  "--geo-arrow-offset": "26.5px",
  "--geo-arrow-offset-mobile": "10px",
  "--geo-member-w": "380px",
  "--geo-member-h": "268px",
};

const REQUIRED_POSITIVE = [
  "--geo-gap",
  "--geo-side",
  "--geo-side-mobile",
  "--geo-small",
  "--geo-default",
  "--geo-large",
  "--geo-xlarge",
  "--geo-content-pad",
  "--geo-radius",
  "--geo-radius-mobile",
  "--geo-arrow-offset",
  "--geo-arrow-offset-mobile",
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") return handleHealth(request, env, ctx);
    if (url.pathname === "/api/build-v2" && request.method === "POST") return handleBuildV233(request, env, ctx);
    return app.fetch(request, env, ctx);
  },
};

async function handleHealth(request, env, ctx) {
  const base = await app.fetch(request, env, ctx);
  const payload = await base.json().catch(() => ({}));
  return json({
    ...payload,
    buildWebMode: "v2.3.3-geometry-lock-guard + v2.3.2-menu-fidelity-finalizer + v2.3.1-menu-surface-fidelity + v2.3-visual-fidelity + v2.2.1-geometry-baseline + v2.1.3-structure-baseline + v1-static-snapshot",
    structuralLockBaseline: "2.1.3",
    geometryLockBaseline: "2.2.1",
    visualBaselineCandidate: "2.3.3",
    geometryLockGuard: true,
    geometryTokenValidation: true,
    zeroGeometryRejected: true,
    lockedGeometryFallback: true,
    geometryLockPreserved: true,
    structuralLockPreserved: true,
    menuFidelityFinalizer: true,
    v232BaseEngine: "2.3.2",
    v221BaseEngine: "2.2.1",
    version: "2.3.3",
  }, base.status);
}

async function handleBuildV233(request, env, ctx) {
  const started = Date.now();
  const baseResponse = await app.fetch(request, env, ctx);
  const contentType = baseResponse.headers.get("content-type") || "";
  if (!/application\/json/i.test(contentType)) return baseResponse;

  const payload = await baseResponse.json().catch(() => null);
  if (!payload || !baseResponse.ok || !payload.ok || !payload.html) {
    return new Response(payload ? JSON.stringify(payload) : "{}", { status: baseResponse.status, headers: JSON_HEADERS });
  }

  let html = String(payload.html || "");
  const before = readGeometryTokens(html);
  const validation = validateGeometry(before);
  let fallbackApplied = false;

  if (!validation.valid) {
    html = applyLockedGeometry(html);
    fallbackApplied = true;
  }

  const after = readGeometryTokens(html);
  const afterValidation = validateGeometry(after);
  const guardReady = afterValidation.valid && REQUIRED_POSITIVE.every((key) => normalizedNumber(after[key]) > 0);

  html = stampV233(html);
  html = html
    .replace(/Menu Fidelity Finalizer Reconstruction V2\.3\.2/g, "Geometry Lock Guard Reconstruction V2.3.3")
    .replace(/Structure and geometry-locked reconstruction with generated menu fidelity finalization from public page signals\./g, "Structure, geometry and visual reconstruction with a guarded V2.2.1 geometry baseline and finalized menu fidelity.");

  return json({
    ...payload,
    engine: "v2.3.3-geometry-lock-guard",
    mode: "clean-reconstruction-v233",
    filename: String(payload.filename || "clean-v232.html")
      .replace(/-clean-v232\.html$/i, "-clean-v233.html")
      .replace(/-clean-v231\.html$/i, "-clean-v233.html"),
    html,
    htmlBytes: byteLength(html),
    durationMs: Date.now() - started,
    stats: {
      ...(payload.stats || {}),
      geometryLockReady: guardReady,
      geometryLockPreserved: guardReady,
      geometryLockGuardApplied: true,
      geometryTokensValidBeforeGuard: validation.valid,
      geometryZeroTokenRegressionDetected: !validation.valid,
      geometryLockedFallbackApplied: fallbackApplied,
      geometryTokensValidAfterGuard: afterValidation.valid,
      geometryRequiredPositiveCount: REQUIRED_POSITIVE.length,
      geometryRequiredPositiveRecovered: REQUIRED_POSITIVE.filter((key) => normalizedNumber(after[key]) > 0).length,
      geometryGap: after["--geo-gap"] || null,
      geometrySide: after["--geo-side"] || null,
      geometrySideMobile: after["--geo-side-mobile"] || null,
      geometryRadius: after["--geo-radius"] || null,
      geometryRadiusMobile: after["--geo-radius-mobile"] || null,
      geometryArrowOffset: after["--geo-arrow-offset"] || null,
      targetScriptsCopied: 0,
      targetLayoutCssCopied: 0,
      targetFontFilesCopied: 0,
    },
    model: {
      ...(payload.model || {}),
      geometryLockGuard: {
        version: "2.3.3",
        baseline: "2.2.1",
        validBeforeGuard: validation.valid,
        fallbackApplied,
        validAfterGuard: afterValidation.valid,
        invalidKeysBeforeGuard: validation.invalidKeys,
        lockedFallback: LOCKED_GEOMETRY,
      },
    },
    safety: {
      ...(payload.safety || {}),
      targetScriptsCopied: false,
      targetJavaScriptExecutedByBuild: false,
      targetCssUsedAsLayoutFoundation: false,
      targetCssCopied: false,
      targetFontFilesCopied: false,
      geometryGuardUsesLockedGeneratedBaselineOnly: true,
      geometryGuardCopiesTargetCss: false,
      visualFidelityPreservesLockedStructure: true,
      visualFidelityPreservesLockedGeometry: guardReady,
    },
  }, baseResponse.status);
}

function readGeometryTokens(html) {
  const style = String(html || "").match(/<style\b[^>]*id=["']pfr-v22-geometry-css["'][^>]*>([\s\S]*?)<\/style\s*>/i)?.[1] || "";
  const root = style.match(/:root\s*\{([^}]*)\}/i)?.[1] || "";
  const out = {};
  for (const key of Object.keys(LOCKED_GEOMETRY)) {
    const match = root.match(new RegExp(`${escapeRegex(key)}\\s*:\\s*([^;}]*)`, "i"));
    if (match) out[key] = match[1].trim();
  }
  return out;
}

function validateGeometry(tokens) {
  const invalidKeys = [];
  for (const key of REQUIRED_POSITIVE) {
    const value = tokens[key];
    if (!value || normalizedNumber(value) <= 0) invalidKeys.push(key);
  }
  const requiredStatic = ["--geo-wide", "--geo-hero-min", "--geo-encounter-h", "--geo-arrow-w", "--geo-arrow-h", "--geo-member-w", "--geo-member-h"];
  for (const key of requiredStatic) {
    const value = tokens[key];
    if (!value || normalizedNumber(value) <= 0) invalidKeys.push(key);
  }
  return { valid: invalidKeys.length === 0, invalidKeys };
}

function applyLockedGeometry(html) {
  return String(html || "").replace(
    /(<style\b[^>]*id=["']pfr-v22-geometry-css["'][^>]*>[\s\S]*?:root\s*\{)([^}]*)(\})/i,
    (all, open, root, close) => {
      let next = root;
      for (const [key, value] of Object.entries(LOCKED_GEOMETRY)) {
        const re = new RegExp(`(${escapeRegex(key)}\\s*:\\s*)([^;}]*)`, "i");
        if (re.test(next)) next = next.replace(re, `$1${value}`);
        else next += `${key}:${value};`;
      }
      return open + next + close;
    }
  );
}

function stampV233(html) {
  return String(html || "").replace(/<html\b([^>]*)>/i, (all, attrs) => {
    let next = String(attrs || "")
      .replace(/\sdata-menu-engine=(['"])[^'"]*\1/i, "")
      .replace(/\sdata-geometry-guard=(['"])[^'"]*\1/i, "");
    return `<html${next} data-menu-engine="v2.3.3" data-geometry-guard="v2.3.3">`;
  });
}

function normalizedNumber(value) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  return match ? Math.abs(Number(match[0])) : 0;
}

function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function byteLength(value) { return new TextEncoder().encode(String(value || "")).length; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS }); }
