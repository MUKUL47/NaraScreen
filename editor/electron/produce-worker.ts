import { parentPort, workerData } from "worker_threads";
import { produceTimelineVideo } from "./produce";

const { sessionDir, version } = workerData as {
  sessionDir: string;
  version?: string;
};

const emit = (msg: string) => {
  parentPort?.postMessage({ type: "progress", msg });
};

(async () => {
  try {
    const finalPath = await produceTimelineVideo(sessionDir, emit, version);
    parentPort?.postMessage({ type: "done", finalPath });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    parentPort?.postMessage({ type: "error", message });
  }
})();
