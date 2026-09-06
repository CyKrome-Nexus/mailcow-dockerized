#!/bin/bash
# Patches SOGo's compiled-in Gravatar URL to point at our own self-hosted
# avatar CDN (Cloudflare R2) instead of gravatar.com, so avatars uploaded
# in the CyKrome Workspaces account panel also show up inside SOGo's own
# UI, contacts and calendar attendee views.
#
# SOGo has no config option for this — the URL is a hardcoded string in
# UI/WebServerResources/js/Common/Gravatar.service.js. We rewrite it in
# place at container boot, idempotently, before handing off to SOGo's
# real entrypoint.
set -e

GRAVATAR_JS="/usr/local/lib/GNUstep/SOGo/WebServerResources/js/Common/Gravatar.service.js"

if [ -n "${AVATAR_R2_PUBLIC_DOMAIN}" ] && [ -f "${GRAVATAR_JS}" ]; then
  if grep -q "www.gravatar.com" "${GRAVATAR_JS}"; then
    sed -i "s|return 'https://www.gravatar.com/avatar/' + hash + '?s=' + s + '&d=' + alternate_avatar;|return 'https://${AVATAR_R2_PUBLIC_DOMAIN}/avatars/' + hash + '.webp';|" "${GRAVATAR_JS}"
    echo "[avatar-cdn] Patched Gravatar.service.js to use https://${AVATAR_R2_PUBLIC_DOMAIN}/avatars/<hash>.webp"
  else
    echo "[avatar-cdn] Gravatar.service.js already patched or has an unexpected shape — skipping"
  fi
else
  echo "[avatar-cdn] AVATAR_R2_PUBLIC_DOMAIN not set or Gravatar.service.js not found — leaving SOGo's default Gravatar URL in place"
fi

exec /docker-entrypoint.sh "$@"
