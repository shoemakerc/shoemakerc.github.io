import { analyze, type Analysis } from "./analyze";
import { analyzeTrack, type TrackAnalysis } from "./track";

// The analysis runs here, off the page's thread: a whole song takes a few
// seconds, and the page should keep scrolling and animating meanwhile.

export type Job = {
  /** A clip is analyzed in one piece; a track section by section. */
  kind: "clip" | "track";
  samples: Float32Array;
  sampleRate: number;
};

export type Reply =
  | { progress: number }
  | { result: Analysis | TrackAnalysis }
  | { error: string };

const reply = (message: Reply) => self.postMessage(message);

self.onmessage = ({ data }: MessageEvent<Job>) => {
  try {
    reply({
      result:
        data.kind === "clip"
          ? analyze(data.samples, data.sampleRate)
          : analyzeTrack(data.samples, data.sampleRate, (progress) => reply({ progress })),
    });
  } catch (error) {
    reply({ error: error instanceof Error ? error.message : String(error) });
  }
};
