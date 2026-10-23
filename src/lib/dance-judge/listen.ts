import { analyze } from "./analyze";

// 22.05 kHz is plenty for beats and keys, and half the work of 44.1. The
// calibration script decodes the previews at the same rate.
const SAMPLE_RATE = 22050;

/** Downloads a preview, decodes it to mono, and analyzes it. */
export async function listen(previewUrl: string, signal?: AbortSignal) {
  const res = await fetch(previewUrl, { signal });
  if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
  const bytes = await res.arrayBuffer();
  // An offline context decodes without needing a click to unlock audio, and
  // resamples to its own rate as it goes.
  const audio = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes);
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const channel = audio.getChannelData(c);
    for (let i = 0; i < channel.length; i++) mono[i] += channel[i] / audio.numberOfChannels;
  }
  signal?.throwIfAborted();
  // Let the "listening" state paint before the analysis ties up the thread.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return analyze(mono, audio.sampleRate);
}
