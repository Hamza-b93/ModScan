'use strict';

// ---- State ----
let scanResult      = null;
let selectedPresets = new Set();
let currentView     = { needed: [], extra: [], totalBytes: 0, totalSize: '0 KB' };
let selectedExtra   = new Set();
let selectedNeeded  = new Set();
let showInvalid     = false;
let distChart       = null;
let toastTimer      = null;

// ---- Chart.js center-text plugin ----
const centerPlugin = {
    id: 'centerText',
    afterDraw(chart) {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        const opts = chart.options.plugins.centerText;
        if (!opts) return;
        const cx = (chartArea.left + chartArea.right) / 2;
        const cy = (chartArea.top  + chartArea.bottom) / 2;
        ctx.save();
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.font         = 'bold 12px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle    = '#93c5fd';
        ctx.fillText(opts.primary   || '', cx, cy - 7);
        ctx.font      = '10px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle = '#475569';
        ctx.fillText(opts.secondary || '', cx, cy + 8);
        ctx.restore();
    }
};
Chart.register(centerPlugin);

// ---- Refs ----
const $ = id => document.getElementById(id);

// ---- Size formatter (mirrors server-side fmtSize) ----
function fmtBytes(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
    return Math.round(bytes / 1e3) + ' KB';
}

// ---- Compute needed/extra from selected presets ----
function computeView() {
    if (!scanResult) return { needed: [], extra: [], totalBytes: 0, totalSize: '0 KB' };

    const { presets, allMods, whitelist } = scanResult;
    const wlIds   = new Set((whitelist || []).map(w => w.id));
    const wlNames = new Set((whitelist || []).map(w => w.name));

    // Union of mods across selected presets (deduped by ID)
    const neededMap = new Map(); // id -> name
    for (const preset of (presets || [])) {
        if (!selectedPresets.has(preset.file)) continue;
        for (const mod of preset.mods) {
            if (!neededMap.has(mod.id)) neededMap.set(mod.id, mod.name);
        }
    }

    const needed = [...neededMap.entries()]
        .map(([id, name]) => ({ name, id, whitelisted: wlIds.has(id) || wlNames.has(name) }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const extra      = (allMods || []).filter(m => !neededMap.has(m.id) && !wlIds.has(m.id));
    const totalBytes = extra.reduce((s, m) => s + m.bytes, 0);

    return { needed, extra, totalBytes, totalSize: fmtBytes(totalBytes) };
}

// ---- Init ----
async function init() {
    const status = await api('GET', '/api/status');
    if (!status) return;
    updateSteamBadge(status.steam);
    if (status.paths.listPath) $('input-list-path').value = status.paths.listPath;
    if (status.paths.modPath)  $('input-mod-path').value  = status.paths.modPath;
    await scan();
}

// ---- Steam badge ----
function updateSteamBadge(steam) {
    const dot   = $('steam-dot');
    const text  = $('steam-text');
    const badge = $('steam-badge');
    if (steam.ready) {
        dot.className    = 'w-1.5 h-1.5 rounded-full bg-emerald-400 transition-colors';
        text.textContent = 'Steam: Running';
        badge.classList.remove('text-slate-500');
        badge.classList.add('text-emerald-400');
    } else {
        dot.className    = 'w-1.5 h-1.5 rounded-full bg-red-400 transition-colors';
        text.textContent = 'Steam: Not Running';
        badge.title      = steam.error || '';
        badge.classList.remove('text-slate-500');
        badge.classList.add('text-red-400');
    }
}

// ---- Settings ----
$('settings-btn').addEventListener('click', () => $('settings-panel').classList.toggle('hidden'));

async function pickFolder(inputId) {
    const result = await api('GET', '/api/pick-folder');
    if (result?.path) $(inputId).value = result.path;
}

$('save-settings-btn').addEventListener('click', async () => {
    const result = await api('POST', '/api/settings', {
        listPath: $('input-list-path').value.trim(),
        modPath:  $('input-mod-path').value.trim(),
    });
    if (result) await scan();
});

// ---- Scan ----
async function scan() {
    const wasFirst      = !scanResult;
    const prevSelection = new Set(selectedPresets);

    showLoading(true);
    $('scan-icon').classList.add('animate-spin');
    selectedExtra.clear();
    selectedNeeded.clear();

    scanResult = await api('POST', '/api/scan');

    $('scan-icon').classList.remove('animate-spin');
    showLoading(false);
    if (!scanResult) return;

    // On first scan select all; on rescan restore previous selection
    const allFiles = new Set((scanResult.presets || []).map(p => p.file));
    if (wasFirst) {
        selectedPresets = new Set(allFiles);
    } else {
        // Restore previous selection, keeping only presets that still exist.
        // An empty selection is valid — it shows all installed mods as unused.
        selectedPresets = new Set([...prevSelection].filter(f => allFiles.has(f)));
    }

    recompute();
}
$('scan-btn').addEventListener('click', scan);

// ---- Recompute view and re-render ----
function recompute() {
    currentView = computeView();
    renderPresets();
    renderStats();
    renderNeeded();
    renderExtra();
    updateChart();
    updateButtons();
}

// ---- Stats bar ----
function renderStats() {
    $('stat-presets').textContent = (scanResult?.presets || []).length;
    $('stat-needed').textContent  = currentView.needed.length;
    $('stat-unused').textContent  = currentView.extra.filter(m => !m.invalid).length;
    $('stat-size').textContent    = currentView.totalSize || '0 KB';
}

// ---- Presets ----
function renderPresets() {
    const list = $('list-presets');
    list.innerHTML = '';
    const presets = scanResult?.presets || [];

    if (!presets.length) { list.appendChild(emptyState('No presets found')); return; }

    for (const p of presets) {
        const sel = selectedPresets.has(p.file);
        const li  = document.createElement('li');
        li.className = [
            'flex items-center gap-2 px-3 py-2 mx-1 my-0.5 rounded-lg border transition-all cursor-pointer text-xs',
            sel ? 'bg-blue-500/15 border-blue-500/30 text-slate-200'
                : 'border-transparent text-slate-600 hover:text-slate-400 hover:bg-slate-800/30',
        ].join(' ');
        li.innerHTML = `
            <svg class="w-3 h-3 shrink-0 ${sel ? 'text-blue-400' : 'text-slate-700'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            <span class="truncate" title="${esc(p.file)}">${esc(p.file.replace(/\.(html|preset2)$/i, ''))}</span>`;
        li.addEventListener('click', () => togglePreset(p.file));
        list.appendChild(li);
    }
}

function togglePreset(file) {
    if (selectedPresets.has(file)) selectedPresets.delete(file);
    else selectedPresets.add(file);
    // Clear mod selections since the visible lists will change
    selectedExtra.clear();
    selectedNeeded.clear();
    recompute();
}

// ---- Needed mods ----
function renderNeeded() {
    const list      = $('list-needed');
    const needed    = currentView.needed;
    const wlEntries = scanResult?.whitelist || [];
    list.innerHTML  = '';

    // Whitelist-only: in whitelist but not referenced by any selected preset
    const neededNames = new Set(needed.map(m => m.name));
    const wlOnly = wlEntries
        .filter(w => !neededNames.has(w.name))
        .map(w => ({ ...w, whitelisted: true, wlOnly: true }));

    const total = needed.length + wlOnly.length;
    $('count-needed').textContent = total;

    if (!total) { list.appendChild(emptyState('No mod lists loaded')); return; }

    const regular     = needed.filter(m => !m.whitelisted);
    const wlInPresets = needed.filter(m =>  m.whitelisted);
    const allWl       = [...wlInPresets, ...wlOnly];

    for (const mod of regular) list.appendChild(neededItem(mod));

    if (allWl.length) {
        const sep = document.createElement('li');
        sep.className = 'flex items-center gap-2 px-3 py-2 mx-1';
        sep.innerHTML = `
            <div class="flex-1 h-px bg-slate-800/80"></div>
            <span class="text-xs text-slate-700 uppercase tracking-wider shrink-0">Whitelist</span>
            <div class="flex-1 h-px bg-slate-800/80"></div>`;
        list.appendChild(sep);
        for (const mod of allWl) list.appendChild(neededItem(mod));
    }
}

function neededItem(mod) {
    const sel = selectedNeeded.has(mod.name);

    let selClass = 'border-transparent hover:bg-slate-800/30';
    if (sel) selClass = mod.whitelisted
        ? 'bg-amber-500/10 border-amber-500/30'
        : 'bg-blue-500/10 border-blue-500/30 ring-1 ring-inset ring-blue-500/15';

    const li = document.createElement('li');
    li.dataset.name = mod.name;
    li.className = `flex items-center gap-2.5 px-3 py-2 mx-1 my-0.5 rounded-lg border transition-all text-sm cursor-pointer ${selClass}`;

    const dotClass  = mod.wlOnly   ? 'bg-amber-400/40 ring-1 ring-amber-400/60'
                    : mod.whitelisted ? 'bg-amber-400'
                    : 'bg-emerald-600/80';
    const textClass = mod.whitelisted
        ? (mod.wlOnly ? 'text-amber-400/70' : 'text-amber-300')
        : sel ? 'text-slate-100' : 'text-slate-400';

    li.innerHTML = `
        <div class="w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}"></div>
        <span class="truncate ${textClass}" title="${esc(mod.name)}${mod.wlOnly ? ' (not in any preset)' : ''}">${esc(mod.name)}</span>`;
    li.addEventListener('click', () => toggleNeed(mod.name));
    return li;
}

// ---- Unused mods ----
function renderExtra() {
    const list    = $('list-extra');
    const extra   = currentView.extra;
    const visible = extra.filter(m => showInvalid || !m.invalid);
    visible.sort((a, b) => b.bytes - a.bytes);

    const maxBytes = visible.reduce((m, e) => Math.max(m, e.bytes), 0);
    list.innerHTML = '';
    $('count-extra').textContent = visible.length;

    if (!visible.length) {
        const allMods = scanResult?.allMods || [];
        let msg = 'No unused mods found';
        if (!allMods.length) {
            msg = 'Mod folder not found — set it in Settings';
        } else if (!extra.length) {
            msg = 'All installed mods are needed or whitelisted';
        } else {
            msg = `${extra.length} invalid mod(s) hidden — enable "Show invalid"`;
        }
        list.appendChild(emptyState(msg));
        return;
    }

    for (const mod of visible) list.appendChild(extraItem(mod, maxBytes));
}

function extraItem(mod, maxBytes) {
    const sel     = selectedExtra.has(mod.id);
    const pct     = maxBytes > 0 ? ((mod.bytes / maxBytes) * 100).toFixed(1) : 0;
    const display = mod.invalid ? `[INVALID] ${mod.id}` : mod.name;

    const li = document.createElement('li');
    li.dataset.id = mod.id;
    li.className = [
        'flex flex-col gap-1.5 px-3 py-2.5 mx-1 my-0.5 rounded-xl border transition-all',
        mod.invalid ? 'cursor-default opacity-40' : 'cursor-pointer',
        sel ? 'bg-blue-500/10 border-blue-500/30 ring-1 ring-inset ring-blue-500/15'
            : 'border-transparent hover:bg-slate-800/40 hover:border-slate-700/30',
    ].join(' ');

    li.innerHTML = `
        <div class="flex items-center justify-between gap-2">
            <span class="text-sm truncate leading-none ${mod.invalid ? 'italic text-slate-600' : mod.unsubbed ? 'text-emerald-400' : sel ? 'text-slate-100' : 'text-slate-300'}"
                  title="${esc(mod.invalid ? mod.id : mod.name)}">
                ${mod.unsubbed ? '✓ ' : ''}${esc(display)}
            </span>
            <span class="text-xs font-mono shrink-0 ${sel ? 'text-blue-300' : 'text-slate-600'}">${mod.size}</span>
        </div>
        ${!mod.invalid ? `
        <div class="h-0.5 rounded-full bg-slate-800 overflow-hidden">
            <div class="h-full rounded-full transition-all duration-500 ${sel ? 'bg-blue-400' : 'bg-blue-700/80'}" style="width:${pct}%"></div>
        </div>` : ''}`;

    if (!mod.invalid) li.addEventListener('click', () => toggleExtra(mod.id));
    return li;
}

function emptyState(text) {
    const li = document.createElement('li');
    li.className = 'flex items-center justify-center py-12 text-slate-700 text-sm';
    li.textContent = text;
    return li;
}

// ---- Donut chart ----
function updateChart() {
    const nCount = currentView.needed.length;
    const eCount = currentView.extra.filter(m => !m.invalid).length;
    const ctx    = $('dist-chart').getContext('2d');

    if (distChart) {
        distChart.data.datasets[0].data              = [eCount, nCount];
        distChart.options.plugins.centerText.primary = currentView.totalSize || '0 KB';
        distChart.update();
        return;
    }

    distChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Unused', 'Needed'],
            datasets: [{
                data: [eCount, nCount],
                backgroundColor: ['rgba(59,130,246,0.75)', 'rgba(15,23,42,0.8)'],
                borderColor:     ['rgba(96,165,250,0.4)', 'rgba(51,65,85,0.4)'],
                borderWidth: 1,
                hoverOffset: 4,
            }],
        },
        options: {
            cutout: '68%',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                centerText: { primary: currentView.totalSize || '0 KB', secondary: 'to free' },
                legend: {
                    position: 'bottom',
                    labels: { color: '#475569', font: { size: 10 }, padding: 8, boxWidth: 8, boxHeight: 8, usePointStyle: true },
                },
                tooltip: { callbacks: { label: c => `  ${c.parsed} mod${c.parsed !== 1 ? 's' : ''}` } },
            },
            animation: { duration: 500 },
        },
    });
}

// ---- Selection ----
function togglePreset(file) {
    if (selectedPresets.has(file)) selectedPresets.delete(file);
    else selectedPresets.add(file);
    selectedExtra.clear();
    selectedNeeded.clear();
    recompute();
}

function toggleExtra(id) {
    if (selectedExtra.has(id)) selectedExtra.delete(id);
    else selectedExtra.add(id);
    renderExtra();
    updateButtons();
}

function toggleNeed(name) {
    if (selectedNeeded.has(name)) selectedNeeded.delete(name);
    else selectedNeeded.add(name);
    renderNeeded();
    updateButtons();
}

function updateButtons() {
    const wlNames  = new Set((scanResult?.whitelist || []).map(w => w.name));
    const selNonWl = [...selectedNeeded].filter(n => !wlNames.has(n));
    const selWl    = [...selectedNeeded].filter(n =>  wlNames.has(n));

    $('unsub-selected-btn').disabled   = selectedExtra.size === 0;
    $('whitelist-add-btn').disabled    = selectedExtra.size === 0 && selNonWl.length === 0;
    $('whitelist-remove-btn').disabled = selWl.length === 0;
}

// ---- Unsubscribe ----
$('unsub-selected-btn').addEventListener('click', async () => {
    if (!selectedExtra.size) return;
    const ids   = [...selectedExtra];
    const names = ids.map(id => currentView.extra.find(m => m.id === id)?.name || id);
    const lines = names.slice(0, 5).join('\n') + (names.length > 5 ? `\n…and ${names.length - 5} more` : '');
    if (!confirm(`Unsubscribe ${ids.length} mod(s)?\n\n${lines}\n\nSteam will remove the files shortly after.`)) return;
    await doUnsub(ids);
});

$('unsub-all-btn').addEventListener('click', async () => {
    const ids = currentView.extra.filter(m => !m.invalid && !m.unsubbed).map(m => m.id);
    if (!ids.length) return toast('No mods to unsubscribe', 'error');
    if (!confirm(`Unsubscribe ALL ${ids.length} unused mod(s)?\nSteam will remove the files shortly after.`)) return;
    await doUnsub(ids);
});

async function doUnsub(ids) {
    showLoading(true);
    const result = await api('POST', '/api/unsubscribe', { ids });
    showLoading(false);
    if (!result) return;
    const ok   = result.results.filter(r =>  r.success).length;
    const fail = result.results.filter(r => !r.success).length;
    toast(
        fail === 0 ? `Unsubscribed ${ok} mod(s). Steam will remove the files shortly.`
                   : `${ok} succeeded, ${fail} failed.`,
        fail > 0 ? 'error' : 'success'
    );
    await scan();
}

// ---- Whitelist ----
$('whitelist-add-btn').addEventListener('click', async () => {
    const fromExtra  = [...selectedExtra].map(id => {
        const mod = currentView.extra.find(m => m.id === id);
        return { name: mod?.name || id, id };
    });
    const wlNames    = new Set((scanResult?.whitelist || []).map(w => w.name));
    const fromNeeded = [...selectedNeeded]
        .filter(name => !wlNames.has(name))
        .map(name => {
            const mod = currentView.needed.find(m => m.name === name);
            return { name, id: mod?.id || '' };
        })
        .filter(e => e.id);
    const entries = [...fromExtra, ...fromNeeded];
    if (!entries.length) return;
    const result = await api('POST', '/api/whitelist/add', { entries });
    if (result) { toast(`Added ${entries.length} mod(s) to whitelist`); await scan(); }
});

$('whitelist-remove-btn').addEventListener('click', async () => {
    const wlNames = new Set((scanResult?.whitelist || []).map(w => w.name));
    const names   = [...selectedNeeded].filter(n => wlNames.has(n));
    if (!names.length) return;
    const result  = await api('POST', '/api/whitelist/remove', { names });
    if (result) { toast(`Removed ${names.length} mod(s) from whitelist`); await scan(); }
});

// ---- Show invalid toggle ----
$('show-invalid-check').addEventListener('change', () => {
    showInvalid = $('show-invalid-check').checked;
    renderExtra();
});

// ---- Helpers ----
function showLoading(on) {
    $('loading-overlay').classList.toggle('hidden', !on);
}

function toast(msg, type = '') {
    const t = $('toast');
    clearTimeout(toastTimer);
    const variants = {
        success: 'bg-emerald-900/90 text-emerald-100 border-emerald-700/50',
        error:   'bg-red-900/90 text-red-100 border-red-700/50',
        '':      'bg-slate-800/95 text-slate-100 border-slate-700/50',
    };
    t.textContent = msg;
    t.className   = `fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl text-sm shadow-2xl border z-50 max-w-lg text-center transition-opacity duration-300 opacity-0 ${variants[type] ?? variants['']}`;
    t.offsetHeight;
    t.classList.replace('opacity-0', 'opacity-100');
    toastTimer = setTimeout(() => {
        t.classList.replace('opacity-100', 'opacity-0');
        setTimeout(() => { t.className = 'hidden'; }, 300);
    }, 4500);
}

function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function api(method, url, body) {
    try {
        const opts = { method, headers: {} };
        if (body) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        const res  = await fetch(url, opts);
        const data = await res.json();
        if (!res.ok) { console.error('[API]', method, url, data.error); toast(data.error || 'Server error', 'error'); return null; }
        return data;
    } catch (err) {
        console.error('[API]', method, url, err);
        toast('Connection error: ' + err.message, 'error');
        return null;
    }
}

// ---- Boot ----
init();
