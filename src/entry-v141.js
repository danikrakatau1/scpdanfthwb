import app from "./entry-v14.js";

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
        buildWebMode: "deep-rendered-snapshot-v14 + challenge-guard + raw-http-fallback-v13",
        renderedSnapshotBuild: true,
        challengeGuard: true,
        staticCompatibilityLayer: true,
        version: "1.4.1",
      });
    }

    if (url.pathname === "/api/scan" && request.method === "POST") {
      const response = await app.fetch(request, env, ctx);
      const contentType = response.headers.get("content-type") || "";
      if (!/application\/json/i.test(contentType)) return response;

      const report = await response.json().catch(() => null);
      if (!report || !response.ok || report.mode !== "deep") {
        return new Response(report ? JSON.stringify(report) : "{}", {
          status: response.status,
          headers: JSON_HEADERS,
        });
      }

      const challenge = detectVerificationChallenge(report);
      if (challenge.detected) {
        const rendered = {
          ...(report.rendered || {}),
          challengeDetected: true,
          challengeKind: challenge.kind,
          challengeEvidence: challenge.evidence,
        };

        return json({
          ...report,
          rendered,
          verdict: {
            code: "BROWSER_VERIFICATION_CHALLENGE",
            label: "Browser verification challenge detected",
            tone: "warning",
          },
          comparison: null,
          buildWeb: {
            available: true,
            mode: "raw-http-static-reconstruction-v13",
            source: "raw-http-fallback",
            prebuilt: null,
            snapshotStatus: "challenge-detected",
            challengeDetected: true,
            challengeKind: challenge.kind,
            note: "Browser Run received a verification/challenge page, so the rendered snapshot was rejected. Build Web will use the safe raw HTTP fallback instead; the tool does not attempt to solve or bypass the verification challenge.",
          },
          safety: {
            ...(report.safety || {}),
            antiBotBypassAttempted: false,
            challengeSnapshotRejected: true,
          },
        }, response.status);
      }

      return json(report, response.status);
    }

    return app.fetch(request, env, ctx);
  },
};

function detectVerificationChallenge(report) {
  const rendered = report?.rendered || {};
  const networkUrls = (rendered.network?.requests || [])
    .map((item) => item?.url || "")
    .join(" ");

  const haystack = [
    rendered.title,
    rendered.textSample,
    rendered.finalUrl,
    networkUrls,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const patterns = [
    ["request-verification", /please\s+wait\s+while\s+your\s+request\s+is\s+being\s+verified/i],
    ["browser-check", /checking\s+(?:your\s+)?browser/i],
    ["human-verification", /verify\s+(?:that\s+)?you\s+are\s+human|human\s+verification/i],
    ["security-check", /security\s+(?:verification|check)|attention\s+required/i],
    ["challenge-page", /just\s+a\s+moment|challenge-platform|captcha|turnstile/i],
  ];

  for (const [kind, regex] of patterns) {
    const match = haystack.match(regex);
    if (match) {
      return {
        detected: true,
        kind,
        evidence: match[0].slice(0, 120),
      };
    }
  }

  return { detected: false, kind: null, evidence: null };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS });
}
