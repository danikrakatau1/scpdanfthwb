const panel = document.querySelector('#buildPanel');
if (panel) {
  const oldButton = document.querySelector('#buildButton');
  if (oldButton) oldButton.textContent = 'Build V1 · Snapshot';

  const actions = document.createElement('div');
  actions.className = 'v2-build-actions';

  const v2Button = document.createElement('button');
  v2Button.id = 'buildV2Button';
  v2Button.type = 'button';
  v2Button.className = 'primary-action v2-primary';
  v2Button.textContent = 'Build V2.3.2 · Menu Fidelity Finalizer';

  if (oldButton?.parentElement) {
    oldButton.parentElement.appendChild(actions);
    actions.append(v2Button, oldButton);
  }

  const result = document.createElement('div');
  result.id = 'buildV2Result';
  result.className = 'v2-result hidden';
  result.innerHTML = `
    <div class="v2-result-head">
      <div>
        <span class="kicker">MENU FIDELITY FINALIZER V2.3.2</span>
        <h3 id="v2Title">Generated reconstruction</h3>
        <p id="v2Meta"></p>
      </div>
      <div class="preview-actions">
        <button id="v2Open" type="button" class="secondary-action">Open preview</button>
        <button id="v2Download" type="button" class="primary-action">Download HTML</button>
      </div>
    </div>
    <div id="v2Metrics" class="mini-grid build-metrics"></div>
    <div class="v2-note">V2.3.2 preserves the V2.1.3 Structure Lock, V2.2.1 Geometry Baseline, V2.3 visual pass and V2.3.1 nested-menu recovery. It finalizes three remaining fidelity gaps from public source signals: exact Blog date/category metadata, the Blog “see all” CTA, and the Destinations submenu label/map/geometry. Output still uses generated CSS/JS only; target JavaScript, target layout CSS and target font files remain excluded.</div>
    <div class="preview-shell v2-preview-shell"><iframe id="v2Preview" title="Menu fidelity finalizer reconstruction preview" sandbox="allow-scripts"></iframe></div>`;
  panel.appendChild(result);

  injectStyles();

  let currentBuild = null;
  const target = document.querySelector('#targetUrl');
  const key = document.querySelector('#accessKey');
  const errorPanel = document.querySelector('#errorPanel');

  v2Button.addEventListener('click', async () => {
    const url = target?.value?.trim();
    if (!url) return;
    hideError();
    v2Button.disabled = true;
    const previous = v2Button.textContent;
    v2Button.textContent = 'Building V2.3.2 finalizer…';
    result.classList.add('hidden');

    try {
      const response = await fetch('/api/build-v2', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key?.value || ''}`,
        },
        body: JSON.stringify({ url }),
      });
      const data = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      currentBuild = data;
      render(data);
      result.classList.remove('hidden');
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      showError('Unable to build V2.3.2 reconstruction', error.message || String(error));
    } finally {
      v2Button.disabled = false;
      v2Button.textContent = previous;
    }
  });

  result.querySelector('#v2Open').addEventListener('click', () => {
    if (!currentBuild?.html) return;
    const blob = new Blob([currentBuild.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });

  result.querySelector('#v2Download').addEventListener('click', () => {
    if (!currentBuild?.html) return;
    const blob = new Blob([currentBuild.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentBuild.filename || 'clean-reconstruction-v232.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  });

  function render(build) {
    result.querySelector('#v2Title').textContent = build.title || 'Menu fidelity finalizer reconstruction';
    result.querySelector('#v2Meta').textContent = `${formatBytes(build.htmlBytes || 0)} · ${formatDuration(build.durationMs || 0)} · ${build.stats?.contentScope || 'scoped content'} · menu finalizer · no target JS/CSS copy`;

    const stats = build.stats || {};
    const metrics = [
      ['Structure lock', stats.structuralLockReady ? 'READY' : 'CHECK'],
      ['Geometry lock', stats.geometryLockReady ? 'READY' : 'CHECK'],
      ['Visual engine', stats.visualFidelityEngineApplied ? 'ACTIVE' : 'CHECK'],
      ['Menu base', stats.menuSurfaceFidelityPolishApplied ? 'ACTIVE' : 'CHECK'],
      ['Menu finalizer', stats.menuFidelityFinalizerApplied ? 'READY' : 'CHECK'],
      ['Blog metadata', stats.blogMetadataFinalizerApplied ? `${stats.blogMetadataCardsFixed ?? 0} FIXED` : 'CHECK'],
      ['Blog see all', stats.blogSeeAllRecovered ? 'RECOVERED' : 'CHECK'],
      ['Destinations label', stats.destinationsLabelClickable ? 'LINKED' : 'CHECK'],
      ['Destinations asset', stats.destinationsSubmenuAssetRecovered ? 'RECOVERED' : 'CHECK'],
      ['Destinations geometry', stats.destinationsSubmenuGeometryRecovered ? 'RECOVERED' : 'CHECK'],
      ['Journey cards', stats.journeyMenuCardsRecovered ?? 0],
      ['About links', stats.aboutSubmenuLinksRecovered ?? 0],
      ['Blog cards', stats.blogMenuCardsRecovered ?? 0],
      ['Secondary links', stats.secondaryMenuLinksRecovered ?? 0],
      ['Target scripts copied', stats.targetScriptsCopied ?? 0],
      ['Target layout CSS copied', stats.targetLayoutCssCopied ?? 0],
    ];
    const box = result.querySelector('#v2Metrics');
    box.innerHTML = '';
    for (const [label, value] of metrics) {
      const item = document.createElement('div');
      item.className = 'mini';
      item.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong>`;
      box.appendChild(item);
    }
    result.querySelector('#v2Preview').srcdoc = build.html || '';
  }

  function showError(title, message) {
    const titleEl = document.querySelector('#errorTitle');
    const messageEl = document.querySelector('#errorMessage');
    if (!errorPanel || !titleEl || !messageEl) return;
    titleEl.textContent = title;
    messageEl.textContent = message;
    errorPanel.classList.remove('hidden');
    errorPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideError() {
    errorPanel?.classList.add('hidden');
  }
}

function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .v2-build-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-left:18px}
    .v2-primary{box-shadow:0 0 0 1px rgba(143,196,255,.12) inset,0 12px 28px rgba(57,141,255,.14)}
    .v2-result{margin-top:24px;padding-top:24px;border-top:1px solid rgba(255,255,255,.09)}
    .v2-result-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:16px}
    .v2-result-head h3{margin:4px 0 5px;font-size:1.15rem}
    .v2-result-head p{margin:0;color:var(--muted,#99a3b6);font-size:.88rem}
    .v2-note{margin:14px 0 16px;padding:12px 14px;border:1px solid rgba(130,190,255,.18);background:rgba(70,139,220,.07);border-radius:14px;color:#aeb8c9;font-size:.88rem}
    .v2-preview-shell{min-height:660px}.v2-preview-shell iframe{min-height:660px}
    @media(max-width:760px){.v2-build-actions{width:100%;margin:14px 0 0}.v2-build-actions button{flex:1 1 100%}.v2-result-head{flex-direction:column}.v2-result-head .preview-actions{width:100%}}
  `;
  document.head.appendChild(style);
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
function formatDuration(ms = 0) { return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`; }
function escapeHtml(value) { return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
