import { parentPort, workerData } from "worker_threads";
import { produceTimelineVideo } from "./produce";

const { sessionDir, version, selectedActionIds, resolution, crf, trim } = workerData as {
  sessionDir: string;
  version?: string;
  selectedActionIds?: string[];
  resolution?: { width: number; height: number };
  crf?: number;
  trim?: { start: number; end: number };
};

const emit = (msg: string) => {
  parentPort?.postMessage({ type: "progress", msg });
};

(async () => {
  try {
    const finalPath = await produceTimelineVideo(sessionDir, emit, version, selectedActionIds, resolution, crf, trim);
    parentPort?.postMessage({ type: "done", finalPath });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    parentPort?.postMessage({ type: "error", message });
  }
})();
