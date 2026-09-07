#!/usr/bin/env bash
#
# Refresh the GeoLite2 snapshot that backs country detection (src/utils/geoip.ts).
#
# `geoip-lite` ships a bundled snapshot that ages from the day the package was published, so an
# address reassigned to another country since then resolves to the old one. This pulls the current
# MaxMind tables and converts them in place.
#
# Requires MAXMIND_LICENSE_KEY (a free MaxMind account; the key is a secret, keep it in .env).
#
# Two details this works around, both verified against geoip-lite 2.0.3:
#  - Its own downloader follows MaxMind's 302 to the signed URL and gets 401 back, so the archives
#    are fetched with curl first. The converter reuses whatever is already in its tmp directory.
#  - Its CSV reader closes readline before the last line is consumed, which is fatal from Node 22
#    on (ERR_USE_AFTER_CLOSE) and silently leaves a half-written IPv6 table behind. So this refuses
#    to run on anything newer than Node 20 — the version the Docker image uses anyway.
set -euo pipefail

if [[ -z "${MAXMIND_LICENSE_KEY:-}" ]]; then
  echo "MAXMIND_LICENSE_KEY is not set. Add it to .env (never to a committed file)." >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR > 20 )); then
  echo "Node ${NODE_MAJOR} crashes geoip-lite's CSV reader mid-write (ERR_USE_AFTER_CLOSE)." >&2
  echo "Run under Node 20, e.g.: nvm exec 20 npm run geoip:update" >&2
  exit 1
fi

GEOIP_DIR="node_modules/geoip-lite"
TMP_DIR="${GEOIP_DIR}/tmp"

if [[ ! -d "$GEOIP_DIR" ]]; then
  echo "geoip-lite is not installed — run npm ci first." >&2
  exit 1
fi

mkdir -p "$TMP_DIR"

for EDITION in GeoLite2-Country-CSV GeoLite2-City-CSV; do
  echo "Fetching ${EDITION}.zip"
  # `|| true` so a 4xx does not trip `set -e` before the status can be reported: curl's own exit
  # code says only "it failed", while the status tells the caller whether to fix the key or wait.
  STATUS="$(curl -sL --retry 3 \
    -o "${TMP_DIR}/${EDITION}.zip" \
    -w '%{http_code}' \
    "https://download.maxmind.com/app/geoip_download?edition_id=${EDITION}&suffix=zip&license_key=${MAXMIND_LICENSE_KEY}" || true)"
  if [[ "$STATUS" == "429" ]]; then
    # MaxMind throttles per account, and updatedb.js spends requests on a checksum per database
    # even when it downloads nothing — so a few runs in quick succession is enough to trip this.
    # Backing off by seconds does not clear it; the limit resets on MaxMind's own schedule.
    echo "MaxMind is rate-limiting this account (HTTP 429). The tables are unchanged; try later." >&2
    exit 1
  fi
  if [[ "$STATUS" != "200" ]]; then
    echo "MaxMind returned HTTP ${STATUS} for ${EDITION}. Check the licence key." >&2
    exit 1
  fi
done

# Keep the tables we already have. The converter writes the .dat files in place, and it dies
# partway through often enough to matter — it still fetches a checksum per database over the
# network, and a reset there (or MaxMind throttling) aborts it mid-write. A half-written table is
# the worst outcome available: it loads without complaint and answers wrongly. So the current data
# is set aside first and put back if anything goes wrong.
BACKUP_DIR="${GEOIP_DIR}/data.before-update"
rm -rf "${BACKUP_DIR:?}"
cp -a "${GEOIP_DIR}/data" "$BACKUP_DIR"

restore_backup() {
  echo "Restoring the previous snapshot — the tables are unchanged." >&2
  rm -rf "${GEOIP_DIR:?}/data"
  mv "$BACKUP_DIR" "${GEOIP_DIR}/data"
}

echo "Converting to geoip-lite format (a few minutes)"
converted=0
for attempt in 1 2 3; do
  if LICENSE_KEY="$MAXMIND_LICENSE_KEY" node "${GEOIP_DIR}/scripts/updatedb.js"; then
    converted=1
    break
  fi
  echo "Conversion attempt ${attempt} failed." >&2
  if (( attempt < 3 )); then
    # A fresh copy of the tables for the retry to write over, since the failed run left the .dat
    # files in an unknown state.
    rm -rf "${GEOIP_DIR:?}/data"
    cp -a "$BACKUP_DIR" "${GEOIP_DIR}/data"
    sleep $(( attempt * 15 ))
  fi
done

if (( converted == 0 )); then
  restore_backup
  echo "Could not refresh the GeoLite2 tables after 3 attempts." >&2
  exit 1
fi

# The extracted CSVs are ~50MB of scratch and are of no use once converted.
rm -rf "${TMP_DIR:?}"/*

echo "Verifying"
if ! node -e '
const geoip = require("geoip-lite");
const expected = { "8.8.8.8": "US", "80.235.1.1": "EE", "212.7.0.1": "EE" };
let failed = false;
for (const [ip, want] of Object.entries(expected)) {
  const got = geoip.lookup(ip)?.country ?? null;
  if (got !== want) { console.error(`  ${ip}: expected ${want}, got ${got}`); failed = true; }
}
if (failed) { console.error("Snapshot looks wrong."); process.exit(1); }
console.log("  country lookups OK");
'; then
  # Tables that answer wrongly are worse than tables that are merely old.
  restore_backup
  exit 1
fi

rm -rf "${BACKUP_DIR:?}"
echo "GeoLite2 snapshot updated."
