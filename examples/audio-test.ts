/**
 * Groq STT test via ARouter gateway (transcription + translation).
 * Run: npx tsx examples/audio-test.ts
 * Requires: Gateway with Groq provider key (valid API key with speech-to-text access).
 * Optional env: AROUTER_BASE_URL, AROUTER_API_KEY, AROUTER_AUDIO_FILE
 */
import * as fs from "node:fs";
import { ARouter } from "../src";

const defaultBaseURL = "http://localhost:19080";
const defaultAPIKey =
  "lr_live_fdfb1fd8db9aaf5981ec033ef49a357d1d16f68fbcbc33ed";
const defaultAudioPath = "/tmp/test_audio.mp3";

async function main() {
  const baseURL = process.env.AROUTER_BASE_URL ?? defaultBaseURL;
  const apiKey = process.env.AROUTER_API_KEY ?? defaultAPIKey;
  const audioPath = process.env.AROUTER_AUDIO_FILE ?? defaultAudioPath;

  const client = new ARouter({ apiKey, baseURL });

  console.log("=== Groq STT SDK Test (Node) ===\n");

  const buf = fs.readFileSync(audioPath);
  const file = new Blob([buf], { type: "audio/mpeg" });
  const model = "groq/whisper-large-v3";

  // Transcription
  console.log("[1] Transcription (groq/whisper-large-v3)");
  const transResp = await client.createTranscription({ model, file });
  console.log("  OK: text =", JSON.stringify(transResp.text));
  if (transResp.language) console.log("  language =", transResp.language);
  console.log();

  // Translation
  console.log("[2] Translation (groq/whisper-large-v3)");
  const translationResp = await client.createTranslation({ model, file });
  console.log("  OK: text =", JSON.stringify(translationResp.text));
  console.log();

  console.log("=== All tests complete ===");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
