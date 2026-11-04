#!/usr/bin/env sh
# Run only while the user's Mac/Linux computer is on. Requires own Google login.
set -u
cd "$(dirname "$0")/.."
BLOGGER_BYEOL_ID=1659014803305858421
export BLOGGER_BYEOL_ID
mkdir -p .local
BYEOL_DRIVE_QUEUE_DIR="${BYEOL_DRIVE_QUEUE_DIR:-}"
if [ -z "$BYEOL_DRIVE_QUEUE_DIR" ] && [ -f .local/byeolsemso-drive-path.txt ]; then
  BYEOL_DRIVE_QUEUE_DIR="$(cat .local/byeolsemso-drive-path.txt)"
fi
if [ -z "$BYEOL_DRIVE_QUEUE_DIR" ]; then
  printf 'Enter local Google Drive for desktop folder path: '
  IFS= read -r BYEOL_DRIVE_QUEUE_DIR
  [ -n "$BYEOL_DRIVE_QUEUE_DIR" ] || exit 2
  printf '%s' "$BYEOL_DRIVE_QUEUE_DIR" > .local/byeolsemso-drive-path.txt
  chmod 600 .local/byeolsemso-drive-path.txt
fi
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 22+ is required. See docs/BLOGGER_NATIVE_IMAGE_PC_SETUP.md'
  exit 2
fi
if [ ! -d node_modules/playwright ]; then
  echo 'Playwright not installed. Follow the one-time setup instructions.'
  exit 2
fi
node scripts/blogger_native_image_queue.cjs --queue "$BYEOL_DRIVE_QUEUE_DIR" --check || exit 1
if [ "${1:-}" = "--watch" ]; then
  echo 'Watch mode: check every 15 minutes while this computer and terminal are running.'
  while : ; do
    node scripts/blogger_native_image_queue.cjs --queue "$BYEOL_DRIVE_QUEUE_DIR" --run || true
    sleep 900
  done
else
  node scripts/blogger_native_image_queue.cjs --queue "$BYEOL_DRIVE_QUEUE_DIR" --run
fi
