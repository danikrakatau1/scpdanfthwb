const $ = (selector) => document.querySelector(selector);

const state = { mode: "quick", report: null, build: null, previewUrl: null };

const scanForm = $("#scanForm");
const targetUrl = $("#targetUrl");
const accessKey = $("#accessKey");
const scanButton = $("#scanButton");
const loading = $("#loading");
const loadingText = $("#loadingText");
const results = $("#results");
const errorPanel = $("#errorPanel");
const healthBadge = $("#healthBadge");
const buildPanel = $("#buildPanel");
const buildButton = $("#buildButton");
const buildLoading = $("#buildLoading");
const buildResult = $("#buildResult");
const previewFrame = $("#previewFrame");
const downloadButton = $("#downloadButton");
const openPreviewButton = $("#openPreviewButton");

for (const button of document.querySelectorAll(".mode")) {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll(".mode").forEach((item) => item.classList.toggle("active", item === button));
  });
}

scanForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();
  resetBuild();
  results.classList.add("hidden");
  loading.classList.remove("hidden");
  scanButton.disabled = true;
  loadingText.textContent = state.mode === "deep"
    ? "Fetching raw HTML, running one Browser Run, sweeping the page, and capturing a sanitized rendered snapshot."
    : "Fetching raw HTML and response metadata.";

  try {
    const response = await fetch("/api/scan", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessKey.value}`,
      },
      body: JSON.stringify({ url: targetUrl.value.trim(), mode: state.mode }),
    });

    const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    state.report = data;
    renderReport(data);
    results.classList.remove("hidden");
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showError("Unable to complete scan", error.message || String(error));
  } finally {
    loading.classList.add("hidden");
    scanButton.disabled = false;
  }
});

buildButton.addEventListener("click", async () => {
  if (!state.report?.target) return;
  hideError();
  buildButton.disabled = true;
  buildLoading.classList.remove("hidden");
  buildResult.classList.add("hidden");

  try {
    const prebuilt = state.report?.buildWeb?.prebuilt;
    if (prebuilt?.html) {
      state.build = prebuilt;
      renderBuild(prebuilt);
      buildResult.classList.remove("hidden");
      buildResult.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const response = await fetch("/api/build", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessKey.value}`,
      },
      body: JSON.stringify({ url: state.report.target }),
    });

    const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);

    state.build = data;
    renderBuild(data);
    buildResult.classList.remove("hidden");
    buildResult.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showError("Unable to build web", error.message || String(error));
  } finally {
    buildLoading.classList.add("hidden");
    buildButton.disabled = false;
  }
});

downloadButton.addEventListener("click", () => {
  if (!state.build?.html) return;
  const blob = new Blob([state.build.html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = state.build.filename || "reconstructed-web.html";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
});

openPreviewButton.addEventListener("click", () => {
  if (!state.build?.html) return;
  const blob = new Blob([state.build.html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});

async function checkHealth() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error("Worker unavailable");

    if (!data.accessKeyConfigured) {
      healthBadge.textContent = "Worker online · key missing";
      healthBadge.className = "badge warning";
    } else if (!data.browserRunConfigured) {
      healthBadge.textContent = "Worker online · quick only";
      healthBadge.className = "badge warning";
    } else if (data.renderedSnapshotBuild) {
      healthBadge.textContent = "Worker + Rendered Snapshot Build ready";
      healthBadge.className = "badge success";
    } else if (data.buildWebConfigured) {
      healthBadge.textContent = "Worker + Browser + Build Web ready";
      healthBadge.className = "badge success";
    } else {
      healthBadge.textContent = "Worker + Browser Run ready";
      healthBadge.className = "badge success";
    }
  } catch {
    healthBadge.textContent = "Worker unavailable";
    healthBadge.className = "badge danger";
  }
}

function renderReport(report) {
  $("#verdictLabel").textContent = report.verdict?.label || "—";
  $("#verdictCode").textContent = report.verdict?.code || "—";
  $("#scoreValue").textContent = `${report.fetchabilityScore ?? 0}/100`;
  $("#httpStatus").textContent = `${report.raw?.status ?? "—"}`;
  $("#httpType").textContent = report.raw?.contentType || "unknown content type";
  $("#duration").textContent = formatDuration(report.durationMs);

  renderFacts($("#rawFacts"), [
    ["Final URL", report.raw?.finalUrl],
    ["Title", report.raw?.title || "—"],
    ["HTML", formatBytes(report.raw?.bodyBytesRead || 0)],
    ["Text", formatNumber(report.raw?.textLength || 0) + " chars"],
    ["Scripts", report.raw?.counts?.scripts ?? 0],
    ["Stylesheets", report.raw?.counts?.stylesheets ?? 0],
    ["Images", report.raw?.counts?.images ?? 0],
    ["Links", report.raw?.counts?.links ?? 0],
    ["Redirects", report.raw?.redirects?.length ?? 0],
  ]);

  if (report.rendered) {
    if (report.rendered.ok) {
      renderFacts($("#renderFacts"), [
        ["Final URL", report.rendered.finalUrl],
        ["Title", report.rendered.title || "—"],
        ["DOM HTML", formatNumber(report.rendered.htmlLength || 0) + " chars"],
        ["Visible text", formatNumber(report.rendered.textLength || 0) + " chars"],
        ["Elements", report.rendered.counts?.elements ?? 0],
        ["Scripts", report.rendered.counts?.scripts ?? 0],
        ["Images", report.rendered.counts?.images ?? 0],
        ["Network", report.rendered.network?.totalCaptured ?? 0],
        ["Blocked writes", report.rendered.network?.blockedRequests?.length ?? 0],
      ]);
    } else {
      renderFacts($("#renderFacts"), [
        ["Deep scan", "Unavailable"],
        ["Reason", report.rendered.error || "Unknown Browser Run error"],
      ]);
    }
  } else {
    renderFacts($("#renderFacts"), [
      ["Deep scan", "Not requested"],
      ["Tip", "Choose Deep passive to compare JavaScript-rendered DOM."],
    ]);
  }

  renderComparison(report.comparison);
  renderTechnologies(report.raw?.technologies || []);
  renderApiHints(report.raw?.apiHints || []);
  renderAssets(report);
  renderSecurityHeaders(report.raw?.securityHeaders || {});
  renderJsonReport(report);

  const hasPrebuilt = Boolean(report.buildWeb?.prebuilt?.html);
  buildButton.textContent = hasPrebuilt ? "Use Rendered Snapshot" : "Build Web";
  buildPanel.classList.toggle("hidden", !report.buildWeb?.available);
}

function renderBuild(build) {
  $("#buildTitle").textContent = build.title || "Static reconstruction";
  const sourceLabel = build.source === "deep-rendered-dom" ? "rendered DOM snapshot" : "raw HTTP fallback";
  $("#buildMeta").textContent = `${formatBytes(build.htmlBytes || 0)} · ${formatDuration(build.durationMs)} · ${sourceLabel} · remote public assets may remain`;

  const stats = build.stats || {};
  const metrics = [
    ["Scripts removed", stats.removedScripts ?? 0],
    ["Frames removed", stats.removedFrames ?? 0],
    ["Images resolved", stats.resolvedImages ?? stats.promotedLazySources ?? 0],
    ["Canvas snapshots", stats.canvasSnapshots ?? 0],
  ];
  const container = $("#buildMetrics");
  container.innerHTML = "";
  for (const [label, value] of metrics) {
    const div = document.createElement("div");
    div.className = "mini";
    div.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
    container.appendChild(div);
  }

  previewFrame.srcdoc = build.html || "";
}

function renderJsonReport(report) {
  const copy = {
    ...report,
    buildWeb: report.buildWeb ? { ...report.buildWeb } : report.buildWeb,
  };

  if (copy.buildWeb?.prebuilt?.html) {
    copy.buildWeb.prebuilt = {
      ...copy.buildWeb.prebuilt,
      html: `[omitted from report view: ${formatBytes(copy.buildWeb.prebuilt.htmlBytes || copy.buildWeb.prebuilt.html.length)} rendered snapshot]`,
    };
  }

  $("#jsonOutput").textContent = JSON.stringify(copy, null, 2);
}

function resetBuild() {
  state.report = null;
  state.build = null;
  buildButton.textContent = "Build Web";
  buildPanel.classList.add("hidden");
  buildResult.classList.add("hidden");
  buildLoading.classList.add("hidden");
  previewFrame.srcdoc = "";
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
}

function renderComparison(comparison) {
  const panel = $("#comparisonPanel");
  const container = $("#comparisonMetrics");
  container.innerHTML = "";

  if (!comparison) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  const items = [
    ["Text similarity", `${Math.round((comparison.textSimilarity || 0) * 100)}%`],
    ["Text growth", signedNumber(comparison.textGrowth) + " chars"],
    ["HTML growth", signedNumber(comparison.htmlGrowth) + " chars"],
    ["Browser-only assets", comparison.browserOnlyAssetCount ?? 0],
  ];

  for (const [label, value] of items) {
    const div = document.createElement("div");
    div.className = "mini";
    div.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
    container.appendChild(div);
  }
}

function renderTechnologies(items) {
  const container = $("#techChips");
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = '<span class="empty">No high-confidence technology fingerprint found.</span>';
    return;
  }

  for (const item of items) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `${escapeHtml(item.name)}<small>${escapeHtml(item.evidence || "")}</small>`;
    container.appendChild(chip);
  }
}

function renderApiHints(items) {
  const container = $("#apiList");
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = '<span class="empty">No API-like URL was exposed in the captured raw markup.</span>';
    return;
  }
  for (const url of items) container.appendChild(urlNode(url));
}

function renderAssets(report) {
  const raw = report.raw?.assets || {};
  const rendered = report.rendered?.ok ? report.rendered : null;
  const groups = [
    ["Scripts", unique([...(raw.scripts || []), ...(rendered?.scripts || [])])],
    ["Stylesheets", raw.stylesheets || []],
    ["Images", unique([...(raw.images || []), ...(rendered?.images || [])])],
  ];

  const container = $("#assetTabs");
  container.innerHTML = "";

  for (const [name, items] of groups) {
    const group = document.createElement("section");
    group.className = "asset-group";
    group.innerHTML = `<h3><span>${escapeHtml(name)}</span><span>${items.length}</span></h3>`;
    const scroll = document.createElement("div");
    scroll.className = "asset-scroll";
    if (!items.length) {
      scroll.innerHTML = '<span class="empty">None captured</span>';
    } else {
      for (const item of items.slice(0, 120)) {
        const div = document.createElement("div");
        div.className = "asset-item";
        div.textContent = item;
        scroll.appendChild(div);
      }
    }
    group.appendChild(scroll);
    container.appendChild(group);
  }
}

function renderSecurityHeaders(headers) {
  const container = $("#securityHeaders");
  container.innerHTML = "";
  for (const [name, value] of Object.entries(headers)) {
    const div = document.createElement("div");
    div.className = `header-card ${value ? "present" : ""}`;
    div.innerHTML = `<strong>${escapeHtml(name)}</strong><span>${escapeHtml(value || "not present")}</span>`;
    container.appendChild(div);
  }
}

function renderFacts(container, rows) {
  container.innerHTML = "";
  for (const [name, value] of rows) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = name;
    dd.textContent = value ?? "—";
    row.append(dt, dd);
    container.appendChild(row);
  }
}

function urlNode(url) {
  const div = document.createElement("div");
  div.className = "url-item";
  div.textContent = url;
  return div;
}

function showError(title, message) {
  $("#errorTitle").textContent = title;
  $("#errorMessage").textContent = message;
  errorPanel.classList.remove("hidden");
  errorPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideError() {
  errorPanel.classList.add("hidden");
}

function formatDuration(ms = 0) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatNumber(value = 0) {
  return new Intl.NumberFormat().format(value);
}

function signedNumber(value = 0) {
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

checkHealth();
