#!/usr/bin/env bash
# deploy/upload.sh LOCAL_DIR REMOTE_PREFIX
# Uploads every file under LOCAL_DIR to public_html/REMOTE_PREFIX on Hostinger through the TUS
# endpoint from the API's "Generate upload URL". Needs UPLOAD_URL, AUTH_KEY and REST_AUTH_KEY in
# the environment; they are never printed. Only the named files are written; nothing is deleted.
set -euo pipefail
src=${1:?local dir}; prefix=${2:?remote prefix}
: "${UPLOAD_URL:?}" "${AUTH_KEY:?}" "${REST_AUTH_KEY:?}"
cd "$src"
find . -type f | sed 's#^\./##' | sort | while read -r f; do
  size=$(stat -c%s "$f")
  dest="$prefix/$f"
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$UPLOAD_URL/$dest?override=true" \
    -H "X-Auth: $AUTH_KEY" -H "X-Auth-Rest: $REST_AUTH_KEY" -H "Tus-Resumable: 1.0.0" \
    -H "Upload-Length: $size" -H "Upload-Offset: 0")
  [ "$code" = 201 ] || { echo "create failed ($code): $dest"; exit 1; }
  if [ "$size" -gt 0 ]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$UPLOAD_URL/$dest?override=true" \
      -H "X-Auth: $AUTH_KEY" -H "X-Auth-Rest: $REST_AUTH_KEY" -H "Tus-Resumable: 1.0.0" \
      -H "Content-Type: application/offset+octet-stream" -H "Upload-Offset: 0" --data-binary "@$f")
    [ "$code" = 204 ] || { echo "upload failed ($code): $dest"; exit 1; }
  fi
  echo "ok $dest ($size bytes)"
done
