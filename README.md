# Passive Fetch / Render Auditor

A standalone Cloudflare Worker for passive web diagnostics. It compares a normal server-side HTTP fetch with an optional JavaScript-rendered Chromium view using Cloudflare Browser Run.

## What it does

- Quick scan: HTTP status, redirects, selected headers, raw HTML/text size, asset inventory, API-like URL hints, technology fingerprints, and security-header presence.
- Deep passive scan: launches Cloudflare Browser Run, renders JavaScript, captures GET/HEAD network requests, inventories the rendered DOM, and compares the rendered view with the raw response.
- Returns a diagnostic fetchability score and one of these result classes: `FETCHABLE`, `JS_DEPENDENT`, `ACCESS_RESTRICTED`, `BROWSER_ACCESS_DIFFERS`, `UPSTREAM_ERROR`, or `LIMITED`.

## Passive / safety policy

This project is intentionally not a bypass or exploitation tool.

- Only `http` / `https` public targets are accepted.
- Literal localhost, private, link-local, multicast, and common metadata targets are blocked.
- Redirect destinations are validated before following them.
- Browser mode blocks non-GET/HEAD requests so forms or write-style XHR/fetch requests are not submitted.
- The API does not accept arbitrary target headers, cookies, credentials, or request bodies.
- Full fetched HTML is never returned by the API; reports contain metadata, short text samples, and bounded URL inventories.
- Use it only on public pages you are authorized or legitimately entitled to inspect.

> Note: hostname validation is defense-in-depth, not a replacement for platform/network egress controls. If you expose this Worker publicly, keep the access key enabled and add Cloudflare rate limiting / Access as appropriate.

## Cloudflare setup

This repository already includes a Browser Run binding in `wrangler.jsonc`:

```json
"browser": {
  "binding": "BROWSER"
}
```

The API is secure-by-default and will refuse scans until an `AUDIT_KEY` Worker secret exists.

### 1. Install dependencies

```bash
npm install
```

### 2. Add an access key

Generate a long random secret locally, then store it as a Cloudflare Worker secret:

```bash
npx wrangler secret put AUDIT_KEY
```

Do **not** commit the value to GitHub.

### 3. Local development

```bash
npm run dev
```

### 4. Deploy

```bash
npm run deploy
```

If the repository is already linked to Cloudflare Git deployments, Cloudflare can build from the repository. Configure `AUDIT_KEY` in the Worker's Variables and Secrets before using `/api/scan`.

## UI

Open the deployed Worker URL, enter:

1. a public target URL,
2. `Quick scan` or `Deep passive`,
3. the configured `AUDIT_KEY`,
4. the authorization checkbox,
5. **Scan**.

The key is sent only in the scan request `Authorization` header and is not saved by the UI.

## API

### Health

```http
GET /api/health
```

### Scan

```http
POST /api/scan
Authorization: Bearer <AUDIT_KEY>
Content-Type: application/json

{
  "url": "https://example.com",
  "mode": "quick"
}
```

Use `"mode": "deep"` to enable Browser Run comparison.

## Files

```text
src/index.js       Worker API + passive scan engine
public/index.html  dashboard
public/app.js       client-side UI
public/styles.css   dashboard styling
wrangler.jsonc      Worker + static assets + Browser Run binding
package.json        Wrangler / Cloudflare Puppeteer dependencies
```

## Current design limits

- Fingerprinting is evidence-based and intentionally conservative; it does not claim vulnerabilities from a version string.
- Asset/API inventories are bounded to keep reports small.
- Deep mode is subject to the Browser Run limits and entitlements of the Cloudflare account.
- A normal page visit can still create ordinary server-side page-view/analytics effects even though write-style browser requests are blocked.
