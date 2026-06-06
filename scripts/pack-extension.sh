#!/bin/bash
# Pack the Chrome extension as both .zip (unpacked install) and .crx (drag-drop install).
# crx is signed with projects/extension.pem (gitignored dev key; auto-created on first run).
set -e

EXT_DIR="projects/extension"
VERSION=$(node -p "require('./$EXT_DIR/manifest.json').version")
ZIP="eds_v${VERSION}.zip"
CRX="eds_v${VERSION}.crx"
KEY="$(pwd)/projects/extension.pem"   # dev signing key (gitignored)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

cd "$EXT_DIR"

# Clean old artifacts
rm -f eds_v*.zip eds_v*.crx

# --- ZIP ---
zip -rq "$ZIP" . \
  -x '*.DS_Store' -x 'src/__tests__/*' -x '*.zip' -x '*.crx' \
  -x 'node_modules/*' -x '*.pem'
echo "Packed: $ZIP"

cd - >/dev/null

# --- CRX (Chrome pack from a clean staging copy, excluding tests/node_modules/artifacts) ---
if [ ! -x "$CHROME" ]; then
  echo "Chrome not found — skipping .crx (zip only)"
  exit 0
fi

STAGE=$(mktemp -d)
rsync -a --exclude 'node_modules' --exclude 'src/__tests__' \
  --exclude '*.zip' --exclude '*.crx' --exclude '*.pem' --exclude '.DS_Store' \
  "$EXT_DIR"/ "$STAGE"/

if [ -f "$KEY" ]; then
  "$CHROME" --pack-extension="$STAGE" --pack-extension-key="$KEY" --no-message-box >/dev/null 2>&1 || true
else
  "$CHROME" --pack-extension="$STAGE" --no-message-box >/dev/null 2>&1 || true
fi

# Chrome (when already running) packs asynchronously in the existing instance —
# poll for the output up to ~10s.
for _ in $(seq 1 20); do
  if [ -f "${STAGE}.crx" ]; then break; fi
  sleep 0.5
done
# Persist the auto-generated key on first run
[ ! -f "$KEY" ] && [ -f "${STAGE}.pem" ] && cp "${STAGE}.pem" "$KEY"

if [ -f "${STAGE}.crx" ]; then
  mv "${STAGE}.crx" "$EXT_DIR/$CRX"
  echo "Packed: $CRX"
else
  echo "crx pack failed — zip only"
fi
rm -rf "$STAGE" "${STAGE}.pem" 2>/dev/null || true
