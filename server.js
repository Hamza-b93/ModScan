'use strict';

const express    = require('express');
const path       = require('path');
const os         = require('os');
const readline   = require('readline/promises');
const { execFile, spawn } = require('child_process');
const steam      = require('./src/steam');
const io         = require('./src/io');

let PORT = 3000; // chosen interactively at startup (see promptStartup)

steam.init();

io.loadSettings();
console.log('[IO] Settings loaded');

const app     = express();
const unsubbed = new Set(); // workshop IDs unsubscribed this session

app.use(express.json());

// ---- CSRF / DNS-rebinding guard ----
// This server performs destructive deletes. Without this, any website the user
// visits while ModScan is running could POST to localhost and wipe their mods.
// Requiring a localhost Host (and a matching Origin when present) blocks both
// cross-origin CSRF and DNS-rebinding attacks.
app.use('/api', (req, res, next) => {
    const allowedHosts   = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
    const allowedOrigins = allowedHosts.map(h => `http://${h}`);

    if (!allowedHosts.includes(req.headers.host)) {
        return res.status(403).json({ error: 'Forbidden: unexpected Host header' });
    }
    if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) {
        return res.status(403).json({ error: 'Forbidden: cross-origin request blocked' });
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ---- Status ----

app.get('/api/status', (_req, res) => {
    res.json({ steam: steam.status(), paths: io.currentPaths() });
});

// ---- Settings ----

app.post('/api/settings', (req, res) => {
    const { listPath, modPath } = req.body;
    try {
        io.saveSettings(listPath || '', modPath || '');
        res.json({ ok: true });
    } catch (err) {
        console.error('[ERR]', err);
        res.status(500).json({ error: err.message });
    }
});

// ---- Scan ----

app.post('/api/scan', async (_req, res) => {
    try {
        io.loadSettings();

        const { presets } = await io.scanPresets();
        const whitelist   = io.readWhitelist();
        const allMods     = await io.scanAllMods();

        allMods.forEach(m => { m.unsubbed = unsubbed.has(m.id); });

        const wlEntries = Object.entries(whitelist).map(([name, id]) => ({ name, id }));

        res.json({ presets, allMods, whitelist: wlEntries });
    } catch (err) {
        console.error('[ERR]', err);
        res.status(500).json({ error: err.message });
    }
});

// ---- Unsubscribe ----

app.post('/api/unsubscribe', async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'No IDs provided' });
    }
    try {
        const results   = await steam.unsubscribeItems(ids);
        const succeeded = results.filter(r => r.success).map(r => r.id);
        succeeded.forEach(id => unsubbed.add(id));

        if (succeeded.length) {
            await io.deleteModFolders(succeeded);
            io.removeIdsFromAcf(succeeded);
        }

        res.json({ results });
    } catch (err) {
        console.error('[ERR]', err);
        res.status(500).json({ error: err.message });
    }
});

// ---- Whitelist ----

app.post('/api/whitelist/add', (req, res) => {
    try {
        io.addToWhitelist(req.body.entries || []);
        res.json({ ok: true });
    } catch (err) {
        console.error('[ERR]', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/whitelist/remove', (req, res) => {
    try {
        io.removeFromWhitelist(req.body.names || []);
        res.json({ ok: true });
    } catch (err) {
        console.error('[ERR]', err);
        res.status(500).json({ error: err.message });
    }
});

// ---- Folder picker ----

app.get('/api/pick-folder', (_req, res) => {
    openFolderDialog()
        .then(p  => res.json({ path: p }))
        .catch(err => res.status(500).json({ error: err.message }));
});

function openFolderDialog() {
    if (process.platform === 'win32') {
        return new Promise((resolve, reject) => {
            const cmd = [
                'Add-Type -AssemblyName System.Windows.Forms;',
                '$f = New-Object System.Windows.Forms.FolderBrowserDialog;',
                '$f.Description = \'Select folder\';',
                'if ($f.ShowDialog() -eq \'OK\') { Write-Output $f.SelectedPath }',
            ].join(' ');
            execFile('powershell', ['-NonInteractive', '-WindowStyle', 'Hidden', '-Command', cmd],
                (err, stdout) => {
                    if (err) return reject(new Error('Could not open folder picker'));
                    resolve(stdout.trim() || null);
                });
        });
    }
    return tryExec('zenity', ['--file-selection', '--directory', '--title=Select Folder'])
        .catch(() => tryExec('kdialog', ['--getexistingdirectory', os.homedir()]))
        .catch(() => { throw new Error('No folder picker found — install zenity or kdialog'); });
}

function tryExec(cmd, args) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, (err, stdout) => {
            if (err && err.code === 'ENOENT') return reject(new Error(`${cmd} not found`));
            resolve(stdout.trim() || null);
        });
    });
}

// ---- Browser launch ----

// Resolve the user's browser choice into a spawnable command per platform.
// Linux candidates are tried in order so e.g. "chrome" works whether the
// binary is google-chrome or google-chrome-stable.
function browserCommand(choice, url) {
    const p = process.platform;

    if (choice === 'default' || !choice) {
        if (p === 'win32')  return [{ cmd: 'cmd',  args: ['/c', 'start', '', url] }];
        if (p === 'darwin') return [{ cmd: 'open', args: [url] }];
        return [{ cmd: 'xdg-open', args: [url] }];
    }

    const known = {
        firefox:  { win: 'firefox',  mac: 'Firefox',        lin: ['firefox'] },
        chrome:   { win: 'chrome',   mac: 'Google Chrome',  lin: ['google-chrome', 'google-chrome-stable'] },
        chromium: { win: 'chromium', mac: 'Chromium',       lin: ['chromium', 'chromium-browser'] },
        edge:     { win: 'msedge',   mac: 'Microsoft Edge', lin: ['microsoft-edge', 'microsoft-edge-stable'] },
        brave:    { win: 'brave',    mac: 'Brave Browser',  lin: ['brave', 'brave-browser'] },
    };
    const b = known[choice];

    if (!b) {
        // Unrecognised name — treat it as a raw executable / app name.
        if (p === 'win32')  return [{ cmd: 'cmd',  args: ['/c', 'start', '', choice, url] }];
        if (p === 'darwin') return [{ cmd: 'open', args: ['-a', choice, url] }];
        return [{ cmd: choice, args: [url] }];
    }

    if (p === 'win32')  return [{ cmd: 'cmd',  args: ['/c', 'start', '', b.win, url] }];
    if (p === 'darwin') return [{ cmd: 'open', args: ['-a', b.mac, url] }];
    return b.lin.map(cmd => ({ cmd, args: [url] }));
}

function launchBrowser(choice, url) {
    if (choice === 'none') {
        console.log('Open that URL in your browser manually.\n');
        return;
    }
    const candidates = browserCommand(choice, url);

    const tryNext = i => {
        if (i >= candidates.length) {
            console.log(`Could not launch "${choice}". Open ${url} in your browser manually.\n`);
            return;
        }
        const { cmd, args } = candidates[i];
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
        child.once('error', () => tryNext(i + 1));
        child.unref();
    };
    tryNext(0);
}

// ---- Interactive startup (runs on every launch) ----

// Read a flag from argv, supporting both "--flag value" and "--flag=value".
function argVal(name) {
    const i = process.argv.indexOf(`--${name}`);
    if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
    const pref = `--${name}=`;
    const eq = process.argv.find(a => a.startsWith(pref));
    return eq ? eq.slice(pref.length) : undefined;
}

function parsePort(raw) {
    const n = parseInt(raw, 10);
    return (Number.isInteger(n) && n >= 1 && n <= 65535) ? n : null;
}

// CLI flags and env vars take precedence and let the app run headless (no TTY):
//   --port <n> / MODSCAN_PORT       --browser <name> / MODSCAN_BROWSER
async function promptStartup() {
    let port    = parsePort(argVal('port') ?? process.env.MODSCAN_PORT);
    let browser = (argVal('browser') ?? process.env.MODSCAN_BROWSER ?? '').trim().toLowerCase() || null;

    // Only prompt for values not already supplied, and only with an interactive stdin.
    if ((port === null || browser === null) && process.stdin.isTTY) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        try {
            if (port === null) {
                port = parsePort((await rl.question('Port to run on [3000]: ')).trim());
            }
            if (browser === null) {
                browser = (await rl.question(
                    'Open in browser (default/firefox/chrome/chromium/edge/brave/none) [default]: '
                )).trim().toLowerCase() || null;
            }
        } finally {
            rl.close();
        }
    }

    PORT = port ?? 3000;
    return { browser: browser || 'default' };
}

// ---- Start ----

(async () => {
    const { browser } = await promptStartup();
    const url = `http://localhost:${PORT}`;

    app.listen(PORT, '127.0.0.1', () => {
        console.log(`\nArma 3 Mod Cleaner → ${url}`);
        launchBrowser(browser, url);
    }).on('error', err => {
        if (err.code === 'EADDRINUSE') {
            console.error(`\nPort ${PORT} is already in use. Restart and choose a different port.`);
        } else {
            console.error('\nServer error:', err.message);
        }
        process.exit(1);
    });
})();
