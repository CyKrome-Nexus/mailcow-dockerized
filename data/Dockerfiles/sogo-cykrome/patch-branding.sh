#!/bin/bash
# Swaps SOGo's own logo assets for the CyKrome Workspaces mark, so the
# webmail toolbar doesn't show the stock "SOGo" wordmark once a user is
# past mailcow's login page (which already redirects to mailcow's own
# form — see custom-sogo.js).
#
# SOGo ships these as static SVG/PNG files under WebServerResources/img,
# not as a config option, so — like patch-avatar-cdn.sh — we overwrite
# them in place at container boot. Every replacement is guarded with
# `-f` so this is a harmless no-op if a SOGo release moves or renames a
# file; it never fails the boot.
set -e

IMG_DIR="/usr/local/lib/GNUstep/SOGo/WebServerResources/img"
MARK="/cykrome-mark.svg"

if [ -f "$MARK" ]; then
  for name in sogo.svg sogo-full.svg sogo-icon.svg; do
    target="${IMG_DIR}/${name}"
    if [ -f "$target" ]; then
      cp "$MARK" "$target"
      echo "[branding] Replaced ${target} with the CyKrome Workspaces mark"
    fi
  done
else
  echo "[branding] ${MARK} not found in image — skipping logo swap"
fi

exec "$@"
