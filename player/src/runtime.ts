import { Scorm12API } from "scorm-again/scorm12";
import { Scorm2004API } from "scorm-again/scorm2004";
import { cmiForResume, type ScormVersion } from "../server/normalize";

type RuntimeApi = Scorm12API | Scorm2004API;

export function attemptKey(courseId: string, itemId: string): string {
  return `${courseId}::${itemId}`;
}

export function attachRuntime(
  version: ScormVersion,
  courseId: string,
  itemId: string,
  saved: unknown,
): RuntimeApi {
  const commitUrl = `/api/scorm/attempts/${encodeURIComponent(attemptKey(courseId, itemId))}/commit`;
  const settings = {
    lmsCommitUrl: commitUrl,
    autocommit: true,
    autocommitSeconds: 15,
    terminateCommitParam: "terminate",
    logLevel: 4,
  };
  clearRuntimes();
  const api = version === "1.2" ? new Scorm12API(settings) : new Scorm2004API(settings);
  api.loadFromJSON(cmiForResume(saved, version));
  if (version === "1.2") window.API = api as Scorm12API;
  else window.API_1484_11 = api as Scorm2004API;
  return api;
}

export function finishRuntime(api: RuntimeApi, version: ScormVersion, started: boolean): void {
  if (!started) {
    clearRuntimes();
    return;
  }
  try {
    // Terminate sends the last bookmark with sendBeacon. A synchronous commit first
    // lands location and suspend_data before the next lesson opens.
    if (version === "1.2") {
      const scorm12 = api as Scorm12API;
      scorm12.LMSCommit("");
      scorm12.LMSFinish("");
    } else {
      const scorm2004 = api as Scorm2004API;
      scorm2004.Commit("");
      scorm2004.Terminate("");
    }
  } finally {
    clearRuntimes();
  }
}

function clearRuntimes(): void {
  delete window.API;
  delete window.API_1484_11;
}

declare global {
  interface Window {
    API?: Scorm12API;
    API_1484_11?: Scorm2004API;
  }
}
