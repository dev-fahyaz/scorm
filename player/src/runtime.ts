import { Scorm12API } from "scorm-again/scorm12";
import { Scorm2004API } from "scorm-again/scorm2004";
import { cmiForResume, type ScormVersion } from "../server/normalize";
import type { Course } from "./types";

type RuntimeApi = Scorm12API | Scorm2004API;

export function attemptKey(courseId: string, itemId: string): string {
  return `${courseId}::${itemId}`;
}

function commitUrlFor(courseId: string, itemId: string): string {
  return `/api/scorm/attempts/${encodeURIComponent(attemptKey(courseId, itemId))}/commit`;
}

function baseSettings(commitUrl: string) {
  return {
    lmsCommitUrl: commitUrl,
    autocommit: true,
    autocommitSeconds: 15,
    terminateCommitParam: "terminate",
    logLevel: 4 as const,
  };
}

export function attachRuntime(
  version: ScormVersion,
  courseId: string,
  itemId: string,
  saved: unknown,
): RuntimeApi {
  const settings = baseSettings(commitUrlFor(courseId, itemId));
  clearRuntimes();
  const api = version === "1.2" ? new Scorm12API(settings) : new Scorm2004API(settings);
  api.loadFromJSON(cmiForResume(saved, version));
  if (version === "1.2") window.API = api as Scorm12API;
  else window.API_1484_11 = api as Scorm2004API;
  return api;
}

export type SequencedRuntime = {
  api: Scorm2004API;
  setDeliveredItem: (itemId: string) => void;
  start: () => Promise<void>;
  navigate: (request: "continue" | "previous" | "exitAll" | "suspendAll") => boolean;
  destroy: () => void;
};

type DeliveryHooks = {
  beforeReset?: () => void;
};

export function attachSequencedRuntime(
  course: Course,
  options: {
    getLaunchUrl: (itemId: string, href: string) => string;
    onDelivery: (itemId: string, title: string, launchUrl: string) => void;
    onNavigation: (state: {
      canPrevious: boolean;
      canNext: boolean;
      hidePrevious?: boolean;
      hideContinue?: boolean;
    }) => void;
    onSessionEnd?: (reason: string) => void;
    initialCmi?: Record<string, unknown> | null;
    beforeActivityReset?: () => void;
  },
): SequencedRuntime {
  if (!course.activityTree) {
    throw new Error("This course has no activity tree.");
  }

  let deliveredItemId = course.items[0]?.id ?? course.activityTree.id;
  let lastDeliveredId: string | null = null;
  const stateUrl = `/api/scorm/courses/${encodeURIComponent(course.id)}/sequencing-state`;
  const launchById = new Map(
    course.items.map((item) => [item.id, options.getLaunchUrl(item.id, item.href)]),
  );

  const settings = {
    ...baseSettings(commitUrlFor(course.id, deliveredItemId)),
    courseId: course.id,
    renderCommonCommitFields: true,
    sequencing: {
      activityTree: course.activityTree,
      collections: course.collections,
      enableEventSystem: true,
      validateNavigationRequests: true,
      autoRollupOnCMIChange: true,
    },
    sequencingStatePersistence: {
      autoLoadOnInitialize: false,
      autoSaveOn: "commit" as const,
      compress: false,
      persistence: {
        saveState: async (stateData: string) => {
          const response = await fetch(stateUrl, {
            method: "PUT",
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            body: stateData,
          });
          return response.ok;
        },
        loadState: async () => {
          const response = await fetch(stateUrl);
          if (!response.ok) return null;
          const payload = (await response.json()) as { state?: string | null };
          return payload.state ?? null;
        },
        clearState: async () => {
          const response = await fetch(stateUrl, { method: "DELETE" });
          return response.ok || response.status === 204;
        },
      },
    },
  };

  clearRuntimes();
  const api = new Scorm2004API(settings);
  if (options.initialCmi) {
    api.loadFromJSON(cmiForResume(options.initialCmi, "2004"));
  }
  window.API_1484_11 = api;

  const publishNavigation = (data?: {
    continue?: boolean;
    previous?: boolean;
    hideLmsUi?: string[];
  }) => {
    // Host Continue/Previous must match previewNavigationRequest — engine
    // continue flags can be optimistic while flow/preconditions still block.
    const cont = api.previewNavigationRequest?.("continue");
    const prev = api.previewNavigationRequest?.("previous");
    const hide = data?.hideLmsUi ?? [];
    options.onNavigation({
      canPrevious: prev?.outcome === "allowed",
      canNext: cont?.outcome === "allowed",
      hidePrevious: hide.includes("previous"),
      hideContinue: hide.includes("continue"),
    });
  };

  const deliverActivity = (
    activity: { id: string; title?: string; hideLmsUi?: string[] },
    hooks: DeliveryHooks = {},
  ) => {
    const item = course.items.find((entry) => entry.id === activity.id);
    const launchUrl = launchById.get(activity.id) || "";
    const switching = Boolean(lastDeliveredId && lastDeliveredId !== activity.id);
    if (switching) {
      hooks.beforeReset?.();
      options.beforeActivityReset?.();
      if (typeof api.reset === "function") {
        api.reset({ preserveListeners: true });
      }
    }
    lastDeliveredId = activity.id;
    deliveredItemId = activity.id;
    api.settings.lmsCommitUrl = commitUrlFor(course.id, activity.id);
    options.onDelivery(activity.id, activity.title || item?.title || activity.id, launchUrl);
  };

  const refreshValidity = () => {
    try {
      const service = api.getSequencingService?.();
      const overall = service?.getOverallSequencingProcess?.();
      overall?.updateNavigationValidity?.();
    } catch {
      /* preview fallback below */
    }
    publishNavigation();
  };

  api.setSequencingEventListeners({
    onActivityDelivery: (activity: { id: string; title?: string; hideLmsUi?: string[] }) => {
      deliverActivity(activity, {
        beforeReset: () => options.beforeActivityReset?.(),
      });
    },
    onNavigationValidityUpdate: (data: {
      continue: boolean;
      previous: boolean;
      hideLmsUi?: string[];
    }) => {
      publishNavigation(data);
    },
    onSequencingSessionEnd: (data: { reason: string }) => {
      options.onSessionEnd?.(data.reason);
    },
  });

  return {
    api,
    setDeliveredItem: (itemId: string) => {
      deliveredItemId = itemId;
      api.settings.lmsCommitUrl = commitUrlFor(course.id, itemId);
    },
    start: async () => {
      await api.loadSequencingState();
      const state = api.getSequencingState?.() ?? {};
      const current = state.currentActivity as { id: string; title?: string } | null | undefined;
      const tree = (
        api.getSequencingService?.() as
          | { sequencing?: { activityTree?: { suspendedActivity?: { id: string } | null } } }
          | null
          | undefined
      )?.sequencing?.activityTree;
      const suspended = tree?.suspendedActivity ?? null;

      if (suspended?.id) {
        api.processNavigationRequest("resumeAll");
        refreshValidity();
        return;
      }

      if (current?.id) {
        // Restored session: re-deliver current SCO. Do not call start (NB.2.1-1).
        deliverActivity(current, {});
        refreshValidity();
        return;
      }

      api.processNavigationRequest("start");
      refreshValidity();
    },
    navigate: (request) => {
      if (request === "continue" || request === "previous") {
        const preview = api.previewNavigationRequest?.(request);
        if (preview?.outcome === "blocked") {
          refreshValidity();
          return false;
        }

        const beforeId = lastDeliveredId;
        if (api.isInitialized?.()) {
          try {
            api.SetValue("adl.nav.request", `_${request}`);
            api.Commit("");
            api.Terminate("");
          } catch {
            /* fall through to processNavigationRequest */
          }
        }

        // If Terminate did not deliver a new activity, ask the sequencer (or restore).
        if (lastDeliveredId === beforeId) {
          if (!api.isInitialized?.()) {
            api.processNavigationRequest(request);
          }
        }

        // Failed continue must not leave a terminated API with a live iframe.
        if (lastDeliveredId === beforeId && beforeId) {
          const item = course.items.find((entry) => entry.id === beforeId);
          options.beforeActivityReset?.();
          if (typeof api.reset === "function") {
            api.reset({ preserveListeners: true });
          }
          deliverActivity(
            { id: beforeId, title: item?.title },
            {},
          );
        }

        refreshValidity();
        return lastDeliveredId !== beforeId;
      }
      const ok = api.processNavigationRequest(request);
      refreshValidity();
      return ok;
    },
    destroy: () => {
      clearRuntimes();
    },
  };
}

export function finishRuntime(api: RuntimeApi, version: ScormVersion, started: boolean): void {
  if (!started) {
    clearRuntimes();
    return;
  }
  try {
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
