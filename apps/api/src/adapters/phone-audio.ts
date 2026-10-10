/**
 * Phone audio codec (AGT-08). Owner: P2.
 * ElevenLabs STT/TTS when ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are set. Otherwise a stub codec
 * whose "audio" is the utf8 text, so the whole call loop runs offline.
 */
import { config } from "../config";

export type Codec = {
  name: "elevenlabs" | "stub";
  tts(text: string): Promise<Uint8Array>;
  stt(audio: Uint8Array): Promise<string>;
};

export const stubCodec: Codec = {
  name: "stub",
  tts: async (text) => new TextEncoder().encode(text),
  stt: async (audio) => new TextDecoder().decode(audio),
};

export function elevenCodec(key: string, voiceId: string): Codec {
  const headers = { "xi-api-key": key };
  return {
    name: "elevenlabs",
    async tts(text) {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST", headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5" }),
      });
      if (!r.ok) throw new Error(`elevenlabs tts ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
    async stt(audio) {
      const form = new FormData();
      form.set("model_id", "scribe_v1");
      form.set("file", new Blob([audio], { type: "audio/mpeg" }), "turn.mp3");
      const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers, body: form });
      if (!r.ok) throw new Error(`elevenlabs stt ${r.status}`);
      return String(((await r.json()) as { text?: string }).text ?? "");
    },
  };
}

/** The real codec when configured, else the stub. */
export function defaultCodec(): Codec {
  return config.elevenlabsApiKey && config.elevenlabsVoiceId ? elevenCodec(config.elevenlabsApiKey, config.elevenlabsVoiceId) : stubCodec;
}
