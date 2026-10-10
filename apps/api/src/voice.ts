/**
 * ElevenLabs TTS for the digest voice recap (AGT-09, stretch). Owner: P2.
 * Writes the mp3 under out/audio/ (served at /audio/...) and returns bytes + URL, or null when
 * ElevenLabs is not configured or fails (kill-switch: drop the recap, keep the text).
 */
import { mkdir } from "node:fs/promises";
import { config } from "./config";

export const AUDIO_DIR = "out/audio";

export async function tts(text: string): Promise<{ bytes: Uint8Array; url: string } | null> {
  if (!config.elevenlabsApiKey || !config.elevenlabsVoiceId) return null;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${config.elevenlabsVoiceId}`, {
    method: "POST",
    headers: { "xi-api-key": config.elevenlabsApiKey, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5" }),
  });
  if (!r.ok) {
    console.warn("elevenlabs tts failed:", r.status);
    return null;
  }
  const bytes = new Uint8Array(await r.arrayBuffer());
  const name = `${new Bun.CryptoHasher("sha1").update(text).digest("hex").slice(0, 12)}.mp3`;
  await mkdir(AUDIO_DIR, { recursive: true });
  await Bun.write(`${AUDIO_DIR}/${name}`, bytes);
  return { bytes, url: `/audio/${name}` };
}
