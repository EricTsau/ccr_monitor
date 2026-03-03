// @ts-check
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  let currentConfig = null;
  let healthMap = {};
  let activeSource = null;
  let availableSources = [];
  let ccrRunning = false;
  let editingProviderIndex = -1;

  // ── Initialization ──
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'updateState') {
      currentConfig = msg.payload.config;
      healthMap = msg.payload.healthMap;
      activeSource = msg.payload.activeSource;
      availableSources = msg.payload.availableSources;
      ccrRunning = msg.payload.ccrRunning;
      render();
    }
  });

  vscode.postMessage({ type: 'requestState' });

  // ── Event Listeners ──
  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'refreshHealth' });
  });

  document.getElementById('btn-add-provider')?.addEventListener('click', () => {
    openProviderEditor(-1);
  });

  document.getElementById('btn-restart-ccr')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'restartCcr' });
  });

  document.getElementById('config-source')?.addEventListener('change', (e) => {
    const select = e.target;
    vscode.postMessage({ type: 'switchConfigSource', payload: { sourceType: select.value } });
  });

  document.getElementById('btn-edit-router')?.addEventListener('click', () => {
    toggleRouterEditor();
  });

  document.getElementById('provider-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveProvider();
  });

  document.getElementById('pf-cancel')?.addEventListener('click', () => {
    closeProviderEditor();
  });

  document.getElementById('pf-delete')?.addEventListener('click', () => {
    if (editingProviderIndex >= 0) {
      vscode.postMessage({ type: 'deleteProvider', payload: { index: editingProviderIndex } });
      closeProviderEditor();
    }
  });

  document.getElementById('pf-add-key')?.addEventListener('click', () => {
    addListItem('pf-keys-list', '');
  });

  document.getElementById('pf-add-model')?.addEventListener('click', () => {
    addListItem('pf-models-list', '');
  });

  document.getElementById('pf-add-transformer')?.addEventListener('click', () => {
    addListItem('pf-transformers-list', '');
  });

  // ── Render ──
  function render() {
    const noConfig = document.getElementById('no-config');
    const dashboard = document.getElementById('dashboard');

    if (!currentConfig) {
      noConfig?.classList.remove('hidden');
      dashboard?.classList.add('hidden');
      return;
    }

    noConfig?.classList.add('hidden');
    dashboard?.classList.remove('hidden');

    renderConfigSourceSwitcher();
    renderProviderCards();
    renderRouterSummary();
    renderQuickSwitch();
    renderCcrStatus();
  }

  function renderConfigSourceSwitcher() {
    const select = document.getElementById('config-source');
    if (!select) { return; }
    select.innerHTML = '';
    for (const src of availableSources) {
      const opt = document.createElement('option');
      opt.value = src.type;
      opt.textContent = src.type === 'global' ? 'Global (' + src.path + ')' : 'Project (' + src.path + ')';
      opt.selected = activeSource?.type === src.type;
      select.appendChild(opt);
    }
  }

  function renderProviderCards() {
    const container = document.getElementById('provider-cards');
    if (!container || !currentConfig) { return; }
    container.innerHTML = '';

    for (let i = 0; i < currentConfig.Providers.length; i++) {
      const provider = currentConfig.Providers[i];
      const health = healthMap[provider.name];
      const status = health?.status || 'checking';

      const card = document.createElement('div');
      card.className = 'provider-card ' + status;
      card.innerHTML =
        '<div class="card-header">' +
          '<span class="status-dot ' + status + '"></span>' +
          '<span class="card-name">' + escapeHtml(provider.name) + '</span>' +
        '</div>' +
        '<div class="card-details">' +
          (health?.latencyMs !== null && health?.latencyMs !== undefined ? health.latencyMs + 'ms ' : '') +
          provider.models.length + ' model' + (provider.models.length !== 1 ? 's' : '') +
        '</div>' +
        (health?.error ? '<div class="card-error">' + escapeHtml(health.error) + '</div>' : '') +
        '<button class="btn-small btn-edit-provider" data-index="' + i + '">Edit</button>';
      container.appendChild(card);
    }

    container.querySelectorAll('.btn-edit-provider').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        var idx = parseInt(e.target.dataset.index || '-1', 10);
        openProviderEditor(idx);
      });
    });
  }

  function renderRouterSummary() {
    const container = document.getElementById('router-summary');
    if (!container || !currentConfig) { return; }
    const router = currentConfig.Router || {};
    const keys = ['default', 'background', 'think', 'longContext', 'webSearch', 'image'];
    let html = '';
    for (const k of keys) {
      if (router[k]) {
        html += '<div class="router-row">' +
          '<span class="route-key">' + k + ':</span>' +
          '<span class="route-value">' + escapeHtml(router[k]) + '</span>' +
        '</div>';
      }
    }
    if (router.longContextThreshold) {
      html += '<div class="router-row">' +
        '<span class="route-key">longContextThreshold:</span>' +
        '<span class="route-value">' + router.longContextThreshold + '</span>' +
      '</div>';
    }
    container.innerHTML = html;
  }

  function renderQuickSwitch() {
    const container = document.getElementById('quick-switch-controls');
    if (!container || !currentConfig) { return; }

    const providers = currentConfig.Providers || [];
    const options = [];
    for (const p of providers) {
      const health = healthMap[p.name];
      const status = health?.status || 'unknown';
      for (const m of p.models) {
        options.push({
          label: p.name + ' / ' + m,
          value: p.name + ',' + m,
          healthy: status === 'healthy',
        });
      }
    }

    const currentDefault = currentConfig.Router?.default || '';

    let optionsHtml = '';
    for (const o of options) {
      optionsHtml += '<option value="' + escapeHtml(o.value) + '"' +
        (o.value === currentDefault ? ' selected' : '') +
        (!o.healthy ? ' style="opacity:0.5"' : '') + '>' +
        (!o.healthy ? '[DOWN] ' : '') + escapeHtml(o.label) +
      '</option>';
    }

    container.innerHTML = '<label for="qs-select">default:</label>' +
      '<select id="qs-select">' + optionsHtml + '</select>' +
      '<button id="qs-apply" class="btn-primary">Apply &amp; Restart</button>';

    document.getElementById('qs-apply')?.addEventListener('click', function() {
      var select = document.getElementById('qs-select');
      if (select) {
        vscode.postMessage({
          type: 'quickSwitch',
          payload: { routeKey: 'default', providerModel: select.value },
        });
      }
    });
  }

  function renderCcrStatus() {
    const el = document.getElementById('ccr-status');
    if (el) {
      el.textContent = ccrRunning ? 'CCR: running' : 'CCR: stopped';
    }
  }

  // ── Provider Editor ──
  function openProviderEditor(index) {
    editingProviderIndex = index;
    const section = document.getElementById('provider-editor-section');
    const title = document.getElementById('provider-editor-title');
    const deleteBtn = document.getElementById('pf-delete');

    if (!section || !title) { return; }
    section.classList.remove('hidden');

    if (index >= 0 && currentConfig) {
      const provider = currentConfig.Providers[index];
      title.textContent = 'Edit Provider: ' + provider.name;
      deleteBtn?.classList.remove('hidden');
      fillProviderForm(provider);
    } else {
      title.textContent = 'Add Provider';
      deleteBtn?.classList.add('hidden');
      fillProviderForm(null);
    }

    section.scrollIntoView({ behavior: 'smooth' });
  }

  function closeProviderEditor() {
    const section = document.getElementById('provider-editor-section');
    section?.classList.add('hidden');
    editingProviderIndex = -1;
  }

  function fillProviderForm(provider) {
    setValue('pf-name', provider?.name || '');
    setValue('pf-url', provider?.api_base_url || '');
    setChecked('pf-rotation', provider?.enable_rotation || false);
    setValue('pf-rotation-strategy', provider?.rotation_strategy || 'round-robin');
    setChecked('pf-retry', provider?.retry_on_failure || false);
    setValue('pf-max-retries', String(provider?.max_retries ?? 3));

    var keysContainer = document.getElementById('pf-keys-list');
    if (keysContainer) {
      keysContainer.innerHTML = '';
      var keys = provider?.api_keys || (provider?.api_key ? [provider.api_key] : []);
      keys.forEach(function(k) { addListItem('pf-keys-list', k); });
      if (keys.length === 0) { addListItem('pf-keys-list', ''); }
    }

    var modelsContainer = document.getElementById('pf-models-list');
    if (modelsContainer) {
      modelsContainer.innerHTML = '';
      (provider?.models || []).forEach(function(m) { addListItem('pf-models-list', m); });
      if (!provider?.models?.length) { addListItem('pf-models-list', ''); }
    }

    var transformersContainer = document.getElementById('pf-transformers-list');
    if (transformersContainer) {
      transformersContainer.innerHTML = '';
      var uses = provider?.transformer?.use || [];
      uses.forEach(function(t) {
        var val = Array.isArray(t) ? t[0] : t;
        addListItem('pf-transformers-list', String(val));
      });
    }
  }

  function saveProvider() {
    var provider = {
      name: getValue('pf-name'),
      api_base_url: getValue('pf-url'),
      api_keys: getListValues('pf-keys-list').filter(Boolean),
      enable_rotation: getChecked('pf-rotation'),
      rotation_strategy: getValue('pf-rotation-strategy'),
      retry_on_failure: getChecked('pf-retry'),
      max_retries: parseInt(getValue('pf-max-retries'), 10) || 3,
      models: getListValues('pf-models-list').filter(Boolean),
      transformer: {
        use: getListValues('pf-transformers-list').filter(Boolean),
      },
    };

    if (!provider.name || !provider.api_base_url) {
      return;
    }

    if (editingProviderIndex >= 0) {
      vscode.postMessage({ type: 'saveProvider', payload: { index: editingProviderIndex, provider: provider } });
    } else {
      vscode.postMessage({ type: 'addProvider', payload: { provider: provider } });
    }
    closeProviderEditor();
  }

  // ── Router Editor ──
  function toggleRouterEditor() {
    var editor = document.getElementById('router-editor');
    if (!editor || !currentConfig) { return; }

    if (editor.classList.contains('hidden')) {
      editor.classList.remove('hidden');
      renderRouterEditor();
    } else {
      editor.classList.add('hidden');
    }
  }

  function renderRouterEditor() {
    var editor = document.getElementById('router-editor');
    if (!editor || !currentConfig) { return; }

    var router = currentConfig.Router || {};
    var keys = ['default', 'background', 'think', 'longContext', 'webSearch', 'image'];
    var routerOptions = buildRouterOptions();

    var html = '';
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var selectOptions = buildSelectOptions(routerOptions, router[k] || '');
      html += '<div class="router-edit-row">' +
        '<label>' + k + ':</label>' +
        '<select class="router-select" data-key="' + k + '">' + selectOptions + '</select>' +
      '</div>';
    }

    html += '<div class="router-edit-row">' +
      '<label>longContextThreshold:</label>' +
      '<input type="number" id="re-threshold" value="' + (router.longContextThreshold || 60000) + '">' +
    '</div>' +
    '<div class="form-actions">' +
      '<button type="button" id="re-cancel" class="btn-small">Cancel</button>' +
      '<button type="button" id="re-save" class="btn-small btn-primary">Save Router</button>' +
    '</div>';

    editor.innerHTML = html;

    document.getElementById('re-cancel')?.addEventListener('click', function() {
      editor.classList.add('hidden');
    });

    document.getElementById('re-save')?.addEventListener('click', function() {
      var newRouter = {};
      editor.querySelectorAll('.router-select').forEach(function(select) {
        if (select.value) {
          newRouter[select.dataset.key] = select.value;
        }
      });
      var threshold = document.getElementById('re-threshold');
      if (threshold?.value) {
        newRouter.longContextThreshold = parseInt(threshold.value, 10);
      }
      vscode.postMessage({ type: 'saveRouter', payload: { router: newRouter } });
      editor.classList.add('hidden');
    });
  }

  // ── Helpers ──
  function buildRouterOptions() {
    var options = [];
    // First option: "(not set)"
    options.push({ value: '', label: '(not set)' });

    if (!currentConfig || !currentConfig.Providers) {
      return options;
    }

    var providers = currentConfig.Providers;
    for (var i = 0; i < providers.length; i++) {
      var provider = providers[i];
      var providerName = provider.name;
      var models = provider.models || [];
      for (var j = 0; j < models.length; j++) {
        var model = models[j];
        var modelName = typeof model === 'string' ? model : model.name;
        if (providerName && modelName) {
          options.push({
            value: providerName + ',' + modelName,
            label: providerName + ' / ' + modelName
          });
        }
      }
    }

    return options;
  }

  function buildSelectOptions(options, currentValue) {
    var html = '';
    for (var i = 0; i < options.length; i++) {
      var opt = options[i];
      var selected = opt.value === currentValue ? ' selected' : '';
      html += '<option value="' + escapeHtml(opt.value) + '"' + selected + '>' + escapeHtml(opt.label) + '</option>';
    }
    return html;
  }

  function addListItem(containerId, value) {
    var container = document.getElementById(containerId);
    if (!container) { return; }
    var div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = '<input type="text" value="' + escapeHtml(value) + '">' +
      '<button type="button" class="btn-remove" title="Remove">x</button>';
    div.querySelector('.btn-remove')?.addEventListener('click', function() { div.remove(); });
    container.appendChild(div);
  }

  function getListValues(containerId) {
    var container = document.getElementById(containerId);
    if (!container) { return []; }
    return Array.from(container.querySelectorAll('input')).map(function(el) { return el.value.trim(); });
  }

  function getValue(id) {
    var el = document.getElementById(id);
    return el?.value?.trim() || '';
  }

  function setValue(id, value) {
    var el = document.getElementById(id);
    if (el) { el.value = value; }
  }

  function getChecked(id) {
    var el = document.getElementById(id);
    return el?.checked || false;
  }

  function setChecked(id, value) {
    var el = document.getElementById(id);
    if (el) { el.checked = value; }
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
