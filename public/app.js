// Application State
const state = {
  requests: [],
  filteredRequests: [],
  activeFilter: 'ALL',
  searchQuery: '',
  sortBy: 'completeness',
  samples: {},
  options: {
    baseUrl: '',
    multiline: true,
    maskHeaders: false,
    compressed: false,
    verbose: false,
    insecure: false,
    followRedirects: false
  }
};

// DOM Elements
const logInput = document.getElementById('logInput');
const lineCountBadge = document.getElementById('lineCountBadge');
const parseBtn = document.getElementById('parseBtn');
const clearInputBtn = document.getElementById('clearInputBtn');
const baseUrlInput = document.getElementById('baseUrlInput');
const multilineToggle = document.getElementById('multilineToggle');
const maskHeadersToggle = document.getElementById('maskHeadersToggle');
const compressedToggle = document.getElementById('compressedToggle');
const verboseToggle = document.getElementById('verboseToggle');
const insecureToggle = document.getElementById('insecureToggle');
const resultsCountBadge = document.getElementById('resultsCountBadge');
const parsingStatus = document.getElementById('parsingStatus');
const searchInput = document.getElementById('searchInput');
const methodFilters = document.getElementById('methodFilters');
const sortBySelect = document.getElementById('sortBySelect');
const requestsList = document.getElementById('requestsList');
const copyAllBtn = document.getElementById('copyAllBtn');
const exportScriptBtn = document.getElementById('exportScriptBtn');
const samplesDropdownBtn = document.getElementById('samplesDropdownBtn');
const samplesMenu = document.getElementById('samplesMenu');
const tabPaste = document.getElementById('tabPaste');
const tabUpload = document.getElementById('tabUpload');
const pasteView = document.getElementById('pasteView');
const uploadView = document.getElementById('uploadView');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const uploadStatus = document.getElementById('uploadStatus');
const themeToggle = document.getElementById('themeToggle');
const themeIconDark = document.getElementById('themeIconDark');
const themeIconLight = document.getElementById('themeIconLight');
const toast = document.getElementById('toast');
const toastMsg = document.getElementById('toastMsg');
const toastIcon = document.getElementById('toastIcon');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  setupTheme();
  await loadSamples();
});

function setupEventListeners() {
  // Parsing Triggers
  parseBtn.addEventListener('click', () => parseCurrentInput());
  
  logInput.addEventListener('input', () => {
    updateLineCount();
    debounceParse();
  });

  logInput.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      parseCurrentInput();
    }
  });

  clearInputBtn.addEventListener('click', () => {
    logInput.value = '';
    updateLineCount();
    state.requests = [];
    state.filteredRequests = [];
    renderResults();
  });

  // Options Changes (triggers dynamic update)
  baseUrlInput.addEventListener('input', () => {
    state.options.baseUrl = baseUrlInput.value.trim();
    if (state.requests.length > 0) parseCurrentInput();
  });

  multilineToggle.addEventListener('change', () => {
    state.options.multiline = multilineToggle.checked;
    if (state.requests.length > 0) parseCurrentInput();
  });

  maskHeadersToggle.addEventListener('change', () => {
    state.options.maskHeaders = maskHeadersToggle.checked;
    if (state.requests.length > 0) parseCurrentInput();
  });

  compressedToggle.addEventListener('change', () => {
    state.options.compressed = compressedToggle.checked;
    if (state.requests.length > 0) parseCurrentInput();
  });

  if (verboseToggle) {
    verboseToggle.addEventListener('change', () => {
      state.options.verbose = verboseToggle.checked;
      if (state.requests.length > 0) parseCurrentInput();
    });
  }

  insecureToggle.addEventListener('change', () => {
    state.options.insecure = insecureToggle.checked;
    if (state.requests.length > 0) parseCurrentInput();
  });

  // Search & Filter
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase();
    applyFilterAndSearch();
  });

  if (sortBySelect) {
    sortBySelect.addEventListener('change', (e) => {
      state.sortBy = e.target.value;
      applyFilterAndSearch();
    });
  }

  methodFilters.addEventListener('click', (e) => {
    const btn = e.target.closest('.method-filter-btn');
    if (!btn) return;

    document.querySelectorAll('.method-filter-btn').forEach(b => {
      b.className = 'method-filter-btn px-2 py-1 rounded-md font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition';
    });
    btn.className = 'method-filter-btn px-2.5 py-1 rounded-md font-semibold bg-sky-500 text-white shadow-sm transition';

    state.activeFilter = btn.dataset.method;
    applyFilterAndSearch();
  });

  // Batch actions
  copyAllBtn.addEventListener('click', copyAllCurls);
  exportScriptBtn.addEventListener('click', exportBashScript);

  // Sample Preset Dropdown
  samplesDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    samplesMenu.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    samplesMenu.classList.add('hidden');
  });

  document.querySelectorAll('.sample-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const sampleKey = btn.dataset.sample;
      if (state.samples[sampleKey + 'Logs'] || state.samples[sampleKey]) {
        switchTab('paste');
        logInput.value = state.samples[sampleKey + 'Logs'] || state.samples[sampleKey];
        updateLineCount();
        parseCurrentInput();
        showToast(`Loaded ${btn.querySelector('span').textContent}`, '✨');
      }
    });
  });

  // Tab switching
  tabPaste.addEventListener('click', () => switchTab('paste'));
  tabUpload.addEventListener('click', () => switchTab('upload'));

  // File Upload Handlers
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('border-sky-500', 'bg-sky-500/10');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('border-sky-500', 'bg-sky-500/10');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('border-sky-500', 'bg-sky-500/10');
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  // Theme Toggle
  themeToggle.addEventListener('click', toggleTheme);
}

function switchTab(tab) {
  if (tab === 'paste') {
    tabPaste.className = 'text-xs font-semibold px-3 py-1 rounded-md bg-sky-500/20 text-sky-400 border border-sky-500/30';
    tabUpload.className = 'text-xs font-medium px-3 py-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition';
    pasteView.classList.remove('hidden');
    uploadView.classList.add('hidden');
  } else {
    tabUpload.className = 'text-xs font-semibold px-3 py-1 rounded-md bg-sky-500/20 text-sky-400 border border-sky-500/30';
    tabPaste.className = 'text-xs font-medium px-3 py-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-700/50 transition';
    uploadView.classList.remove('hidden');
    pasteView.classList.add('hidden');
  }
}

function updateLineCount() {
  const lines = logInput.value ? logInput.value.split('\n').length : 0;
  lineCountBadge.textContent = `${lines} line${lines === 1 ? '' : 's'}`;
}

let debounceTimer = null;
function debounceParse() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (logInput.value.trim().length > 0) {
      parseCurrentInput();
    }
  }, 400);
}

async function parseCurrentInput() {
  const text = logInput.value.trim();
  if (!text) {
    state.requests = [];
    state.filteredRequests = [];
    renderResults();
    return;
  }

  parsingStatus.textContent = 'Parsing...';

  try {
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        baseUrl: baseUrlInput.value.trim(),
        multiline: multilineToggle.checked,
        maskHeaders: maskHeadersToggle.checked,
        compressed: compressedToggle.checked,
        verbose: verboseToggle ? verboseToggle.checked : false,
        insecure: insecureToggle.checked
      })
    });

    const data = await res.json();
    if (data.success) {
      state.requests = data.requests || [];
      applyFilterAndSearch();
      parsingStatus.textContent = `Parsed ${data.count} request${data.count === 1 ? '' : 's'}`;
    } else {
      parsingStatus.textContent = 'Error: ' + (data.error || 'Failed to parse');
    }
  } catch (err) {
    console.error(err);
    parsingStatus.textContent = 'Failed to connect to parser';
  }
}

async function handleFileSelect(e) {
  if (e.target.files.length > 0) {
    handleFileUpload(e.target.files[0]);
  }
}

async function handleFileUpload(file) {
  uploadStatus.classList.remove('hidden');
  uploadStatus.innerHTML = `<span class="text-sky-400">Uploading and parsing ${file.name}...</span>`;

  const formData = new FormData();
  formData.append('logfile', file);
  formData.append('baseUrl', baseUrlInput.value.trim());
  formData.append('multiline', multilineToggle.checked);
  formData.append('maskHeaders', maskHeadersToggle.checked);
  formData.append('compressed', compressedToggle.checked);
  formData.append('verbose', verboseToggle ? verboseToggle.checked : false);
  formData.append('insecure', insecureToggle.checked);

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (data.success) {
      state.requests = data.requests || [];
      applyFilterAndSearch();
      uploadStatus.innerHTML = `<span class="text-emerald-400">✓ Parsed ${data.count} request(s) from ${file.name}</span>`;
      showToast(`Parsed ${data.count} requests from ${file.name}`, '📂');
    } else {
      uploadStatus.innerHTML = `<span class="text-rose-400">Failed: ${data.error}</span>`;
    }
  } catch (err) {
    uploadStatus.innerHTML = `<span class="text-rose-400">Upload error</span>`;
  }
}

function applyFilterAndSearch() {
  const METHOD_PRIORITY = { 'POST': 1, 'PUT': 2, 'PATCH': 3, 'DELETE': 4, 'GET': 5, 'HEAD': 6, 'OPTIONS': 7 };

  // 1. Filter
  let filtered = state.requests.filter(req => {
    if (state.activeFilter !== 'ALL' && req.method !== state.activeFilter) {
      return false;
    }

    if (state.searchQuery) {
      const q = state.searchQuery;
      const matchUrl = req.url.toLowerCase().includes(q);
      const matchMethod = req.method.toLowerCase().includes(q);
      const matchLog = req.rawLog.toLowerCase().includes(q);
      const matchHeaders = Object.entries(req.headers || {}).some(([k, v]) => 
        k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)
      );
      const matchBody = req.body && req.body.toLowerCase().includes(q);

      if (!matchUrl && !matchMethod && !matchLog && !matchHeaders && !matchBody) {
        return false;
      }
    }

    return true;
  });

  // 2. Sort by composition / completeness (default) or user selection
  filtered.sort((a, b) => {
    if (state.sortBy === 'completeness') {
      const scoreDiff = (b.completenessScore || 0) - (a.completenessScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return (a.lineNumber || 1) - (b.lineNumber || 1);
    } else if (state.sortBy === 'line') {
      return (a.lineNumber || 1) - (b.lineNumber || 1);
    } else if (state.sortBy === 'method') {
      const pA = METHOD_PRIORITY[a.method] || 99;
      const pB = METHOD_PRIORITY[b.method] || 99;
      return pA - pB || (b.completenessScore || 0) - (a.completenessScore || 0);
    }
    return 0;
  });

  state.filteredRequests = filtered;
  renderResults();
}

function renderResults() {
  const total = state.requests.length;
  const filteredCount = state.filteredRequests.length;

  resultsCountBadge.textContent = total === filteredCount 
    ? `${total} Request${total === 1 ? '' : 's'} Found`
    : `${filteredCount} of ${total} Requests`;

  copyAllBtn.disabled = filteredCount === 0;
  exportScriptBtn.disabled = filteredCount === 0;

  if (filteredCount === 0) {
    requestsList.innerHTML = `
      <div class="bg-slate-800/40 border border-slate-800 border-dashed rounded-xl p-12 text-center flex flex-col items-center justify-center space-y-3 animate-fade-in">
        <div class="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-500">
          <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
        </div>
        <div>
          <h3 class="text-sm font-semibold text-slate-300">${total > 0 ? 'No requests match filter' : 'No HTTP requests parsed yet'}</h3>
          <p class="text-xs text-slate-500 mt-1 max-w-sm">${total > 0 ? 'Try clearing your search query or changing the method filter.' : 'Paste logs on the left or click "Load Sample Logs" above.'}</p>
        </div>
      </div>
    `;
    return;
  }

  requestsList.innerHTML = state.filteredRequests.map((req, index) => {
    const curl = state.options.multiline ? req.multilineCurl || req.curlCommand : req.singlelineCurl || req.curlCommand;
    const headerCount = Object.keys(req.headers || {}).length;
    const hasBody = req.body && req.body.trim().length > 0;
    const isTopComposition = index === 0 && (req.completenessScore || 0) >= 50;

    return `
      <div class="bg-slate-800/80 border ${isTopComposition ? 'border-sky-500/60 ring-1 ring-sky-500/30' : 'border-slate-700/80 hover:border-slate-600'} rounded-xl p-4 shadow-md transition space-y-3 animate-fade-in" data-id="${req.id}">
        <!-- Request Card Top Bar -->
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center space-x-2 overflow-hidden">
            <span class="badge-${req.method} font-bold px-2 py-0.5 text-xs rounded-md uppercase tracking-wider">${req.method}</span>
            <span class="font-mono text-xs font-medium text-slate-200 truncate max-w-md" title="${escapeHtml(req.url)}">${escapeHtml(req.url)}</span>
            
            ${isTopComposition ? `<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1 shadow-sm">🌟 Best Match</span>` : ''}
            ${hasBody ? `<span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">Payload</span>` : ''}
            ${headerCount > 0 ? `<span class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300">${headerCount} hdr${headerCount === 1 ? '' : 's'}</span>` : ''}
            ${req.statusCode ? `<span class="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${req.statusCode < 400 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}">${req.statusCode}</span>` : ''}
          </div>
          <div class="flex items-center space-x-2">
            <span class="text-[10px] text-slate-400 bg-slate-900/60 px-2 py-0.5 rounded border border-slate-700/50">${escapeHtml(req.format)}</span>
            <span class="text-[10px] text-slate-500 font-mono">Line ${req.lineNumber}</span>
          </div>
        </div>

        <!-- Generated cURL Code Block -->
        <div class="relative group">
          <pre class="curl-code bg-slate-950 border border-slate-700/80 rounded-lg p-3 text-xs text-sky-200 overflow-x-auto selection:bg-sky-500 selection:text-white leading-relaxed"><code>${escapeHtml(curl)}</code></pre>
          <button class="copy-single-btn absolute top-2 right-2 px-2.5 py-1 rounded bg-slate-800/90 hover:bg-sky-600 text-slate-300 hover:text-white border border-slate-700 hover:border-sky-500 text-[11px] font-semibold flex items-center space-x-1 shadow transition opacity-90 group-hover:opacity-100" data-curl="${escapeHtml(curl)}">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            <span>Copy</span>
          </button>
        </div>

        <!-- Collapsible Details Toggle -->
        <details class="group/details text-xs">
          <summary class="cursor-pointer text-slate-400 hover:text-slate-200 select-none flex items-center space-x-1.5 py-1">
            <svg class="w-3.5 h-3.5 transform group-open/details:rotate-90 transition-transform text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
            <span class="font-medium">Details (${headerCount} headers${hasBody ? ', has body' : ''})</span>
          </summary>

          <div class="mt-2.5 space-y-3 pt-2 border-t border-slate-750">
            <!-- Headers -->
            ${headerCount > 0 ? `
              <div>
                <span class="text-[11px] font-semibold text-slate-400 block mb-1">HTTP Headers</span>
                <div class="bg-slate-900/80 rounded-lg p-2.5 border border-slate-700/60 font-mono text-[11px] space-y-1">
                  ${Object.entries(req.headers).map(([k, v]) => `
                    <div class="flex"><span class="text-sky-400 min-w-[130px]">${escapeHtml(k)}:</span> <span class="text-slate-300 break-all">${escapeHtml(String(v))}</span></div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            <!-- Request Body -->
            ${hasBody ? `
              <div>
                <span class="text-[11px] font-semibold text-slate-400 block mb-1">Payload / Body</span>
                <pre class="bg-slate-900/80 rounded-lg p-2.5 border border-slate-700/60 font-mono text-[11px] text-amber-200 overflow-x-auto max-h-40"><code>${escapeHtml(req.body)}</code></pre>
              </div>
            ` : ''}

            <!-- Original Log Snippet -->
            <div>
              <span class="text-[11px] font-semibold text-slate-400 block mb-1">Original Log Line</span>
              <pre class="bg-slate-900/80 rounded-lg p-2 border border-slate-700/60 font-mono text-[10px] text-slate-400 overflow-x-auto whitespace-pre-wrap"><code>${escapeHtml(req.rawLog || '')}</code></pre>
            </div>
          </div>
        </details>
      </div>
    `;
  }).join('');

  // Attach individual copy button events
  document.querySelectorAll('.copy-single-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const textToCopy = btn.getAttribute('data-curl');
      copyToClipboard(textToCopy);
      const span = btn.querySelector('span');
      const original = span.textContent;
      span.textContent = 'Copied! ✓';
      btn.classList.add('bg-emerald-600', 'text-white');
      setTimeout(() => {
        span.textContent = original;
        btn.classList.remove('bg-emerald-600', 'text-white');
      }, 1500);
    });
  });
}

function copyAllCurls() {
  if (state.filteredRequests.length === 0) return;

  const allCurls = state.filteredRequests.map(r => 
    state.options.multiline ? r.multilineCurl || r.curlCommand : r.singlelineCurl || r.curlCommand
  ).join('\n\n');

  copyToClipboard(allCurls);
  showToast(`Copied ${state.filteredRequests.length} cURL command(s)!`, '📋');
}

async function exportBashScript() {
  if (state.filteredRequests.length === 0) return;

  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: state.filteredRequests,
        multiline: state.options.multiline,
        baseUrl: baseUrlInput.value.trim()
      })
    });

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `curl_requests_${Date.now()}.sh`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast('Downloaded bash script (.sh)', '💾');
  } catch (err) {
    showToast('Failed to export script', '❌');
  }
}

async function loadSamples() {
  try {
    const res = await fetch('/api/samples');
    state.samples = await res.json();
  } catch (err) {
    console.warn('Could not load samples:', err);
  }
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

function showToast(message, icon = '✅') {
  toastMsg.textContent = message;
  toastIcon.textContent = icon;
  toast.classList.remove('translate-y-20', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
    toast.classList.remove('translate-y-0', 'opacity-100');
  }, 2500);
}

function setupTheme() {
  const isDark = localStorage.getItem('theme') !== 'light';
  applyTheme(isDark);
}

function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  applyTheme(!isDark);
  localStorage.setItem('theme', !isDark ? 'dark' : 'light');
}

function applyTheme(isDark) {
  if (isDark) {
    document.documentElement.classList.add('dark');
    themeIconDark.classList.remove('hidden');
    themeIconLight.classList.add('hidden');
  } else {
    document.documentElement.classList.remove('dark');
    themeIconDark.classList.add('hidden');
    themeIconLight.classList.remove('hidden');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
