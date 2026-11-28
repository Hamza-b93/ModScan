#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APPDIR="$ROOT_DIR/AppDir"
OUT="$ROOT_DIR/dist/ModScan-x86_64.AppImage"

if [ ! -f "$ROOT_DIR/dist/modscan-linux" ]; then
    echo "Missing dist/modscan-linux — run 'npm run build:linux' first." >&2
    exit 1
fi

rm -rf "$APPDIR"
mkdir -p \
    "$APPDIR/usr/bin" \
    "$APPDIR/usr/share/applications" \
    "$APPDIR/usr/share/icons/hicolor/scalable/apps"

install -Dm755 "$ROOT_DIR/dist/modscan-linux" "$APPDIR/usr/bin/modscan"
install -Dm644 "$ROOT_DIR/packaging/modscan.desktop" "$APPDIR/modscan.desktop"
install -Dm644 "$ROOT_DIR/packaging/modscan.desktop" "$APPDIR/usr/share/applications/modscan.desktop"
install -Dm644 "$ROOT_DIR/packaging/modscan.svg" "$APPDIR/modscan.svg"
install -Dm644 "$ROOT_DIR/packaging/modscan.svg" "$APPDIR/.DirIcon"
install -Dm644 "$ROOT_DIR/packaging/modscan.svg" "$APPDIR/usr/share/icons/hicolor/scalable/apps/modscan.svg"

cat > "$APPDIR/AppRun" << 'EOF'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/bin/modscan" "$@"
EOF
chmod +x "$APPDIR/AppRun"

APPIMAGETOOL="${APPIMAGETOOL:-}"
if [ -z "$APPIMAGETOOL" ]; then
    if command -v appimagetool >/dev/null 2>&1; then
        APPIMAGETOOL="appimagetool"
    else
        APPIMAGETOOL="/tmp/appimagetool-x86_64.AppImage"
        if [ ! -f "$APPIMAGETOOL" ]; then
            curl -fsSL -o "$APPIMAGETOOL" \
                "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage"
            chmod +x "$APPIMAGETOOL"
        fi
    fi
fi

ARCH=x86_64 "$APPIMAGETOOL" --appimage-extract-and-run "$APPDIR" "$OUT"
rm -rf "$APPDIR"
echo "Built $OUT"
