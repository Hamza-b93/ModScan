'use strict';

const fs   = require('fs');
const fsP  = require('fs').promises;
const path = require('path');
const os   = require('os');

function resolveDataDir() {
    if (process.env.MODSCAN_DATA_DIR) {
        fs.mkdirSync(process.env.MODSCAN_DATA_DIR, { recursive: true });
        return process.env.MODSCAN_DATA_DIR;
    }
    if (process.env.SNAP_USER_DATA) {
        fs.mkdirSync(process.env.SNAP_USER_DATA, { recursive: true });
        return process.env.SNAP_USER_DATA;
    }
    if (process.env.FLATPAK_ID || process.env.APPIMAGE) {
        const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
        const dir = path.join(xdg, 'modscan');
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    const defaultDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
    try {
        fs.accessSync(defaultDir, fs.constants.W_OK);
        return defaultDir;
    } catch (_) {
        const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
        const dir = path.join(xdg, 'modscan');
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    }
}

const DATA_DIR = resolveDataDir();
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.txt');
const WHITELIST_FILE = path.join(DATA_DIR, 'whitelist.txt');

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

    // Key-based parse so the file survives reordering, blank lines and new keys.
    if (fs.existsSync(SETTINGS_FILE)) {
        for (const line of fs.readFileSync(SETTINGS_FILE, 'utf-8').split('\n')) {
            const eq = line.indexOf('=');
            if (eq === -1) continue;
            const key = line.slice(0, eq).trim();
            const val = line.slice(eq + 1).trim();
            if      (key === 'listPath') savedList = val;
            else if (key === 'modPath')  savedMod  = val;
        }
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

// Cap concurrent filesystem operations so a large workshop (thousands of
// files across hundreds of mods) can't exhaust file descriptors (EMFILE).
function pLimit(max) {
    let active = 0;
    const queue = [];
    const next = () => {
        if (active >= max || queue.length === 0) return;
        active++;
        const { fn, resolve, reject } = queue.shift();
        fn().then(resolve, reject).finally(() => { active--; next(); });
    };
    return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

const fsLimit = pLimit(32);

async function getDirSize(dir) {
    let entries;
    try {
        entries = await fsLimit(() => fsP.readdir(dir, { withFileTypes: true }));
    } catch (_) {
        return 0;
    }
    const sizes = await Promise.all(entries.map(e => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return getDirSize(p);
        if (e.isFile())      return fsLimit(() => fsP.stat(p)).then(s => s.size).catch(() => 0);
        return Promise.resolve(0);
    }));
    return sizes.reduce((a, b) => a + b, 0);
}

function fmtSize(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB';
    if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
    return Math.round(bytes / 1e3) + ' KB';
}

// ---------- Unsubscribe helpers ----------

async function deleteModFolders(ids) {
    const deleted = [];
    for (const id of ids) {
        const dir = path.join(modPath, String(id));
        try {
            await fsP.rm(dir, { recursive: true, force: true });
            deleted.push(id);
        } catch (err) {
            console.warn(`[IO] Could not delete ${dir}:`, err.message);
        }
    }
    return deleted;
}

function removeIdsFromAcf(ids) {
    // appworkshop_107410.acf lives two levels above modPath (workshop/content/107410 → workshop/)
    const acfPath = path.join(modPath, '..', '..', 'appworkshop_107410.acf');
    if (!fs.existsSync(acfPath)) {
        console.warn(`[IO] appworkshop_107410.acf not found at ${acfPath} — skipping ACF cleanup. ` +
                     'Steam may try to re-download the removed mods. Check that the mod folder ' +
                     'points to steamapps/workshop/content/107410.');
        return;
    }

    const toRemove = new Set(ids.map(String));
    const lines = fs.readFileSync(acfPath, 'utf-8').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const trimmed = lines[i].trim();
        const m = trimmed.match(/^"(\d+)"$/);
        if (m && toRemove.has(m[1])) {
            // Skip this ID line and its following { ... } block
            i++;
            while (i < lines.length && lines[i].trim() !== '{') i++;
            if (i < lines.length) {
                i++; // skip opening {
                let depth = 1;
                while (i < lines.length && depth > 0) {
                    const t = lines[i].trim();
                    if (t === '{') depth++;
                    else if (t === '}') depth--;
                    i++;
                }
            }
        } else {
            out.push(lines[i]);
            i++;
        }
    }

    fs.writeFileSync(acfPath, out.join('\n'), 'utf-8');
    console.log(`[IO] Removed ${ids.length} item(s) from appworkshop_107410.acf`);
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
    deleteModFolders, removeIdsFromAcf,
};
