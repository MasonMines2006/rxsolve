#!/usr/bin/env bash
# INF-01: prove the sponsor APIs answer. Reads .env. Record results in docs/STATUS.md.
set -u
set -a; [ -f .env ] && . ./.env; set +a

echo "--- Nessie (classic) ---"
curl -s -o /dev/null -w "%{http_code}\n" "http://api.nessieisreal.com/customers?key=${NESSIE_KEY:-}"
echo "    401/404 => try v2 with header auth against /v2/accounts"

echo "--- ElevenLabs TTS ---"
mkdir -p out
curl -s -o out/probe.mp3 -w "%{http_code}\n" -X POST "https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID:-}" \
  -H "xi-api-key: ${ELEVENLABS_API_KEY:-}" -H "Content-Type: application/json" \
  -d '{"text":"RxSolve online","model_id":"eleven_turbo_v2_5"}'

echo "--- Photon Spectrum ---"
[ -n "${PHOTON_PROJECT_ID:-}" ] && echo "    project id set; run 'bun api' and look for 'spectrum: iMessage connected'" \
  || echo "    PHOTON_PROJECT_ID missing (see README: Photon setup)"
