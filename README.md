# Arma 3 Mod Cleaner

A local web app that scans your Arma 3 launcher presets, identifies mods you have installed but no longer use in any preset, and lets you unsubscribe and delete them in bulk.

---

## How It Works

The app reads your Arma 3 launcher preset files (`.html` or `.preset2`) to build a list of mods you actively use. It then compares that list against every mod folder in your Steam Workshop directory for Arma 3. Any mod that does not appear in any selected preset (and is not on your whitelist) is shown as **unused**.

When you unsubscribe from unused mods the app:

1. Calls the Steam Workshop API to remove the subscription from your Steam account.
2. Deletes the mod folder from disk immediately — you see the space freed right away.
3. Removes the entry from Steam's local `appworkshop_107410.acf` file so Steam does not attempt to re-download it on the next launch.

---

## Requirements

- [Node.js](https://nodejs.org/) v18 or newer (v26 recommended via [Volta](https://volta.sh/))
- Steam must be running before you start the app
- Arma 3 must **not** be running when you use the app (Steam will otherwise block workshop changes)

---

## Installation

```bash
git clone <repo-url>
cd ModScan
npm install
```

---

## Usage

### 1. Start Steam first

Make sure Steam is fully open and logged in before launching the app.

### 2. Start the app

**Linux:**
```bash
./start.sh
# or
npm start
```

**Windows:**
```
start.bat
# or
npm start
```

The app will print:
```
Arma 3 Mod Cleaner → http://localhost:3000
```

Open that URL in your browser.

### 3. Configure paths (first run)

Click the **Settings** button (top right) and set:

| Setting | What it should point to |
|---|---|
| **Preset folder** | The folder containing your `.html` or `.preset2` launcher presets |
| **Mod folder** | The Steam Workshop content folder for Arma 3 (see defaults below) |

**Default paths — Linux (native Steam):**
```
Presets: ~/.local/share/Steam/steamapps/compatdata/107410/pfx/drive_c/users/steamuser/AppData/Local/Arma 3 Launcher/Presets
Mods:    ~/.local/share/Steam/steamapps/workshop/content/107410
```

**Default paths — Windows:**
```
Presets: %LOCALAPPDATA%\Arma 3 Launcher\Presets
Mods:    C:\Program Files (x86)\Steam\steamapps\workshop\content\107410
```

If your Steam library is on a different drive or partition, set the mod folder manually to wherever `steamapps/workshop/content/107410` lives.

Click **Save & Rescan** after changing paths.

### 4. Select your presets

The left panel lists all preset files found in your preset folder. Click a preset to toggle it on or off. The **Unused** list on the right updates immediately to show only mods that are not required by any selected preset.

### 5. Review unused mods

Unused mods are sorted by size (largest first). Each entry shows the mod name and how much disk space it occupies. Click a mod to select it.

- **Select All / Unsubscribe All** — acts on every unused mod at once.
- **Unsubscribe Selected** — acts only on the mods you clicked.

### 6. Whitelist mods you want to keep

If a mod should never appear in the unused list (e.g. a mod you use outside of presets), select it and click **Add to Whitelist**. Whitelisted mods are shown in the preset panel with an amber indicator and are excluded from the unused list regardless of which presets are selected.

To remove a mod from the whitelist, select it in the preset panel and click **Remove from Whitelist**.

### 7. Unsubscribe

Click **Unsubscribe Selected** (or **Unsubscribe All**) and confirm the prompt. The app processes each mod one at a time. When done, it rescans automatically and the freed space is reflected in the stats bar.

### 8. Stop the app BEFORE closing Steam

> **Important:** Always stop the Node.js server before closing Steam.
>
> Because the app initialises the Steam API using Arma 3's app ID, Steam shows Arma 3 as "running" while the server is active. If you close Steam while the server is still running, Steam can crash (SIGSEGV in its internal thread). The correct shutdown order is:
>
> 1. Close the browser tab.
> 2. Stop the server (`Ctrl+C` in the terminal, or close the terminal window).
> 3. Then close Steam normally.

---

## Features at a Glance

| Feature | Description |
|---|---|
| Preset-aware scanning | Reads `.html` and `.preset2` launcher presets |
| Multi-preset selection | Toggle any combination of presets; unused list updates live |
| Size breakdown | Each unused mod shows its disk footprint; total shown in the stats bar |
| Donut chart | Visual split of needed vs unused mods |
| Whitelist | Permanently exclude mods from the unused list |
| Bulk unsubscribe | Remove one, selected, or all unused mods in one click |
| Immediate file deletion | Mod folders are deleted right away, not after Steam restarts |
| ACF cleanup | Removes entries from `appworkshop_107410.acf` to prevent re-download |
| Invalid mod detection | Flags mod folders that have no `meta.cpp` (broken installs) |
| Folder picker | Browse for paths without typing (requires `zenity` or `kdialog` on Linux) |
| Auto-reconnect to Steam | If Steam was not running when the server started, it reconnects automatically on the first API call |

---

## File Structure

```
ModScan/
├── server.js          # Express server and API routes
├── src/
│   ├── steam.js       # steamworks.js wrapper (init, unsubscribe)
│   └── io.js          # Preset scanning, mod folder ops, ACF editing
├── public/
│   ├── index.html     # UI
│   └── app.js         # Frontend logic
├── settings.txt       # Saved paths (auto-generated)
├── whitelist.txt      # Whitelisted mods (auto-generated)
├── steam_appid.txt    # Tells steamworks.js to use Arma 3 (107410)
├── start.sh           # Linux launcher
└── start.bat          # Windows launcher
```

---

## Troubleshooting

**"Steam not initialized — make sure Steam is running"**
Steam was not open when the server started, or it crashed. Start (or restart) Steam and try again — the app will reconnect automatically without needing a server restart.

**Mods still appear after unsubscribing**
This should no longer happen as the app deletes the folders and updates the ACF file. If you see a mod return, check that the mod folder path in Settings points to the correct `workshop/content/107410` directory.

**Mod folder size does not change immediately**
The size shown in the OS may be cached. The app calculates size itself and will show the correct values after the next scan.

**Steam crashes when closing it**
You closed Steam while the server was still running. See the shutdown order in [step 8](#8-stop-the-app-before-closing-steam) above.

**Folder picker does not open (Linux)**
Install `zenity` (GTK) or `kdialog` (KDE):
```bash
# Arch / Manjaro
sudo pacman -S zenity
# Ubuntu / Debian
sudo apt install zenity
```

---

## License

See [LICENSE](LICENSE).
