'use strict';

const fs   = require('fs');
const fsP  = require('fs').promises;
const path = require('path');
const os   = require('os');

const SETTINGS_FILE = path.join(__dirname, '..', 'settings.txt');
const WHITELIST_FILE = path.join(__dirname, '..', 'whitelist.txt');

let listPath = '';
let modPath  = '';

// ---------- Settings ----------

function defaultPaths() {
    const home = os.homedir();

    if (process.platform === 'win32') {
        const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
        return {
            listPath: path.join(local, 'Arma 3 Launcher', 'Presets'),
            modPath:  'C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\107410',
        };
    }

    // Linux — try native Steam, then Flatpak
    const candidates = [
        path.join(home, '.steam', 'steam'),
        path.join(home, '.local', 'share', 'Steam'),
        path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.steam', 'steam'),
        path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
    ];
    const base = candidates.find(p => fs.existsSync(p)) || candidates[0];

    return {
        listPath: path.join(base, 'steamapps', 'compatdata', '107410', 'pfx',
                            'drive_c', 'users', 'steamuser', 'AppData', 'Local',
                            'Arma 3 Launcher', 'Presets'),
        modPath: path.join(base, 'steamapps', 'workshop', 'content', '107410'),
    };
}

function loadSettings() {
    let savedList = '';
    let savedMod  = '';

    if (fs.existsSync(SETTINGS_FILE)) {
        const lines = fs.readFileSync(SETTINGS_FILE, 'utf-8').split('\n');
        savedList = (lines[0] || '').split('=').slice(1).join('=').trim();
        savedMod  = (lines[1] || '').split('=').slice(1).join('=').trim();
    }

    const d  = defaultPaths();
    listPath = (savedList && fs.existsSync(savedList)) ? savedList : d.listPath;
    modPath  = (savedMod  && fs.existsSync(savedMod))  ? savedMod  : d.modPath;
}

function saveSettings(newListPath, newModPath) {
    if (newListPath) listPath = newListPath;
    if (newModPath)  modPath  = newModPath;
    fs.writeFileSync(SETTINGS_FILE, `listPath=${listPath}\nmodPath=${modPath}\n`);
}

function currentPaths() {
    return { listPath, modPath };
}

// ---------- Preset parsing ----------

function parseHtml(content) {
    const mods = {};
    const dlcs = {};
    let currentName = null;

    for (const line of content.split('\n')) {
        const nameMatch = line.match(/<td\s+data-type="DisplayName">([^<]+)<\/td>/);
        if (nameMatch) {
            currentName = nameMatch[1].trim();
            continue;
        }
        const hrefMatch = line.match(/href="([^"]+)"/);
        if (hrefMatch && currentName) {
            const href = hrefMatch[1];
            const idMatch = href.match(/[?&]id=(\d+)/);
            if (idMatch) mods[currentName] = idMatch[1];
            else         dlcs[currentName] = href.split('/').pop();
            currentName = null;
        }
    }
    return { mods, dlcs };
}

function parsePreset2(content) {
    const ids = [];
    let m;
    const re = /<id>steam:(\d+)<\/id>/g;
    while ((m = re.exec(content)) !== null) ids.push(m[1]);
    return ids;
}

async function readModName(workshopId) {
    try {
        const content = await fsP.readFile(path.join(modPath, workshopId, 'meta.cpp'), 'utf-8');
        const m = content.match(/name\s*=\s*"([^"]+)"/i);
        return m ? m[1].trim() : null;
    } catch (_) {
        return null;
    }
}

async function scanPresets() {
    if (!listPath || !fs.existsSync(listPath)) {
        return { presets: [], dlcs: {} };
    }

    const files  = fs.readdirSync(listPath).filter(f => f.endsWith('.html') || f.endsWith('.preset2'));
    const dlcs   = {};
    const result = [];

    for (const file of files) {
        const content  = await fsP.readFile(path.join(listPath, file), 'utf-8');
        const fileMods = {}; // name -> id, for this file only

        if (file.endsWith('.html')) {
            const r = parseHtml(content);
            Object.assign(fileMods, r.mods);
            Object.assign(dlcs, r.dlcs);
        } else {
            for (const id of [...new Set(parsePreset2(content))]) {
                const name = await readModName(id);
                if (name) fileMods[name] = id;
                else if (modPath && fs.existsSync(path.join(modPath, id))) fileMods[id] = id;
            }
        }

        result.push({ file, mods: Object.entries(fileMods).map(([name, id]) => ({ name, id })) });
    }

    return { presets: result, dlcs };
}

async function scanAllMods() {
    if (!modPath || !fs.existsSync(modPath)) return [];

    const entries = fs.readdirSync(modPath, { withFileTypes: true }).filter(e => e.isDirectory());

    return Promise.all(entries.map(async e => {
        const id    = e.name;
        const name  = await readModName(id);
        const bytes = await getDirSize(path.join(modPath, id));
        return { id, name, bytes, size: fmtSize(bytes), invalid: !name };
    }));
}

// ---------- Mod scanning ----------

async function getDirSize(dir) {
    let total = 0;
    try {
        const entries = await fsP.readdir(dir, { withFileTypes: true });
        const sizes   = await Promise.all(entries.map(e => {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) return getDirSize(p);
            if (e.isFile())      return fsP.stat(p).then(s => s.size).catch(() => 0);
            return Promise.resolve(0);
        }));
        total = sizes.reduce((a, b) => a + b, 0);
    } catch (_) {}
    return total;
}

function fmtSize(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
    return Math.round(bytes / 1e3) + ' KB';
}

function readWhitelist() {
    const wl = {};
    if (!fs.existsSync(WHITELIST_FILE)) return wl;
    for (const line of fs.readFileSync(WHITELIST_FILE, 'utf-8').split('\n').filter(Boolean)) {
        const slash = line.indexOf('/');
        if (slash > -1) wl[line.slice(0, slash)] = line.slice(slash + 1).trim();
    }
    return wl;
}

async function findExtraMods(neededIds, whitelistIds, unsubbed) {
    if (!modPath || !fs.existsSync(modPath)) return [];

    const all     = fs.readdirSync(modPath, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
    const needed  = new Set(neededIds);
    const wl      = new Set(whitelistIds);
    const extras  = all.filter(id => !needed.has(id) && !wl.has(id));

    return Promise.all(extras.map(async id => {
        const name  = await readModName(id);
        const bytes = await getDirSize(path.join(modPath, id));
        return {
            name,
            id,
            bytes,
            size:    fmtSize(bytes),
            invalid: !name,
            unsubbed: unsubbed.has(id),
        };
    }));
}

function addToWhitelist(entries) {
    const lines = fs.existsSync(WHITELIST_FILE)
        ? fs.readFileSync(WHITELIST_FILE, 'utf-8').split('\n').filter(Boolean)
        : [];
    for (const { name, id } of entries) lines.push(`${name}/${id}`);
    fs.writeFileSync(WHITELIST_FILE, lines.join('\n') + '\n');
}

function removeFromWhitelist(names) {
    const wl = readWhitelist();
    for (const n of names) delete wl[n];
    const lines = Object.entries(wl).map(([k, v]) => `${k}/${v}`);
    fs.writeFileSync(WHITELIST_FILE, lines.join('\n') + (lines.length ? '\n' : ''));
}

module.exports = {
    loadSettings, saveSettings, currentPaths,
    scanPresets, scanAllMods, readWhitelist,
    addToWhitelist, removeFromWhitelist, fmtSize,
};
