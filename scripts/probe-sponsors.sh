#!/usr/bin/env bash
# INF-01: prove the sponsor APIs answer. Reads .env. Record results in docs/STATUS.md.
set -u
set -a; [ -f .env ] && . ./.env; set +a
mkdir -p out

echo "--- Nessie (classic v1, HTTPS; plain HTTP no longer connects) ---"
# Read-only on purpose. Nessie never rejects a key on reads (they are scoped to the key: any key gets 200),
# and every write with a valid key creates data, so this only proves reachability and shows what the key owns.
# A bad key is only caught on a write (401 "Invalid API key"); INF-04's first transfer is that check.
[ -z "${NESSIE_KEY:-}" ] && echo "    NESSIE_KEY missing"
for p in customers accounts; do
  code=$(curl -s -m 20 -o out/nessie.json -w "%{http_code}" "https://api.nessieisreal.com/$p?key=${NESSIE_KEY:-}")
  echo "    GET /$p -> $code, $(grep -o '"_id"' out/nessie.json | wc -l | tr -d ' ') owned by this key"
done
echo "--- ElevenLabs TTS (stretch, optional) ---"
curl -s -o out/probe.mp3 -w "%{http_code}\n" -X POST "https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID:-}" \
  -H "xi-api-key: ${ELEVENLABS_API_KEY:-}" -H "Content-Type: application/json" \
  -d '{"text":"RxSolve online","model_id":"eleven_turbo_v2_5"}'

echo "--- Photon Spectrum ---"
[ -n "${PHOTON_PROJECT_ID:-}" ] && echo "    project id set; run 'bun api' and look for 'spectrum: iMessage connected'" \
  || echo "    PHOTON_PROJECT_ID missing (see README: Photon setup)"
