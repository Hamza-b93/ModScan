'use strict';

const express    = require('express');
const path       = require('path');
const os         = require('os');
const { execFile } = require('child_process');
const steam      = require('./src/steam');
const io         = require('./src/io');

steam.init();

io.loadSettings();
console.log('[IO] Settings loaded');

const app     = express();
const unsubbed = new Set(); // workshop IDs unsubscribed this session

app.use(express.json());
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

// ---- Start ----

const PORT = 3000;
app.listen(PORT, '127.0.0.1', () => {
    console.log(`\nArma 3 Mod Cleaner → http://localhost:${PORT}`);
    console.log('Open that URL in your browser.\n');
});
