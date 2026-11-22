import type { Analysis } from "./analyze";
import { MIN_SECONDS, type TrackAnalysis } from "./track";
import type { Job, Reply } from "./worker";

// 22.05 kHz is plenty for beats and keys, and half the work of 44.1. The
// calibration script decodes the previews at the same rate.
const SAMPLE_RATE = 22050;

// Decoding holds the whole song in memory, uncompressed. These keep a
// two-hour mix from taking the tab down.
const MAX_BYTES = 300e6;
const MAX_LOSSY_BYTES = 60e6;
const MAX_SECONDS = 20 * 60;
const LOSSLESS = /\.(wav|wave|aiff?|flac)$/i;

/** Why a file can't be judged, in words fit to show. */
export class Unjudgeable extends Error {}

async function decode(bytes: ArrayBuffer) {
  // An offline context decodes without needing a click to unlock audio, and
  // resamples to its own rate as it goes.
  const audio = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes);
  const samples = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const channel = audio.getChannelData(c);
    for (let i = 0; i < channel.length; i++) samples[i] += channel[i] / audio.numberOfChannels;
  }
  return { samples, sampleRate: audio.sampleRate };
}

type Options = { signal?: AbortSignal; onProgress?: (fraction: number) => void };

/** Runs one analysis in a worker of its own, which stopping can simply end. */
function run<T extends Analysis | TrackAnalysis>(job: Job, { signal, onProgress }: Options) {
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url));
    const finish = (settle: () => void) => {
      worker.terminate();
      signal?.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = () => finish(() => reject(signal!.reason));
    signal?.addEventListener("abort", onAbort);
    worker.onerror = (event) => finish(() => reject(new Error(event.message)));
    worker.onmessage = ({ data }: MessageEvent<Reply>) => {
      if ("progress" in data) onProgress?.(data.progress);
      else if ("error" in data) finish(() => reject(new Error(data.error)));
      else finish(() => resolve(data.result as T));
    };
    worker.postMessage(job, [job.samples.buffer]);
  });
}

/** Downloads a preview, decodes it to mono, and analyzes it. */
export async function listen(previewUrl: string, signal?: AbortSignal) {
  const res = await fetch(previewUrl, { signal });
  if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
  const audio = await decode(await res.arrayBuffer());
  signal?.throwIfAborted();
  return run<Analysis>({ kind: "clip", ...audio }, { signal });
}

/**
 * Decodes a whole song from its file's bytes and analyzes it section by
 * section. Nothing is uploaded; it all happens in the page. Decoding empties
 * the buffer, so read anything else you need from it first.
 */
export async function listenToFile(bytes: ArrayBuffer, name: string, options: Options = {}) {
  if (bytes.byteLength > (LOSSLESS.test(name) ? MAX_BYTES : MAX_LOSSY_BYTES)) {
    throw new Unjudgeable("That file is too big for the judge. Try a single song.");
  }
  const audio = await decode(bytes).catch(() => {
    throw new Unjudgeable("The judge couldn’t read that file. MP3, M4A, WAV and FLAC usually work.");
  });
  options.signal?.throwIfAborted();
  const seconds = audio.samples.length / audio.sampleRate;
  if (seconds < MIN_SECONDS) {
    throw new Unjudgeable("That’s too short to judge. Give it at least eight seconds.");
  }
  if (seconds > MAX_SECONDS) {
    throw new Unjudgeable("That’s more of a mix than a song. The judge stops at twenty minutes.");
  }
  return run<TrackAnalysis>({ kind: "track", ...audio }, options);
}
