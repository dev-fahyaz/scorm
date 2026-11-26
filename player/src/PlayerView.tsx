import { useEffect, useRef, useState } from "react";
import { getCourse } from "./api";
import { navigate } from "./App";
import { formatClock, normalizeCommit, statusLabel, totalSeconds } from "../server/normalize";
import {
  attachRuntime,
  attachSequencedRuntime,
  finishRuntime,
  type SequencedRuntime,
} from "./runtime";
import type { Attempt, Course } from "./types";

type NavState = {
  canPrevious: boolean;
  canNext: boolean;
  hidePrevious: boolean;
  hideContinue: boolean;
};

export function PlayerView({ courseId, itemId }: { courseId: string; itemId: string | null }) {
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState("");
  const [activeItemId, setActiveItemId] = useState<string | null>(itemId);
  const [activeTitle, setActiveTitle] = useState("");
  const [live, setLive] = useState({
    completion: "not attempted",
    success: null as "passed" | "failed" | null,
    scoreRaw: null as number | null,
  });
  const [elapsed, setElapsed] = useState(0);
  const [nav, setNav] = useState<NavState>({
    canPrevious: false,
    canNext: false,
    hidePrevious: false,
    hideContinue: false,
  });
  const [outlineOpen, setOutlineOpen] = useState(true);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const savedCmi = useRef(new Map<string, Record<string, unknown>>());
  const cacheCourseId = useRef<string | null>(null);
  const sequencedRef = useRef<SequencedRuntime | null>(null);
  const deliveredIdRef = useRef<string | null>(null);

  function blankFrame(): void {
    const frame = frameRef.current;
    if (frame) frame.src = "about:blank";
  }

  useEffect(() => {
    let ignore = false;
    getCourse(courseId)
      .then((next) => {
        if (!ignore) setCourse(next);
      })
      .catch((reason: unknown) => {
        if (!ignore)
          setError(reason instanceof Error ? reason.message : "The course could not be opened.");
      });
    return () => {
      ignore = true;
    };
  }, [courseId]);

  const sequenced = Boolean(
    course?.hasSequencing && course.activityTree && course.version === "2004",
  );
  const item =
    course?.items.find((entry) => entry.id === (activeItemId || itemId)) ??
    course?.items[0] ??
    null;
  const attempt = course?.attempts?.find((entry) => entry.itemId === item?.id) ?? null;

  useEffect(() => {
    if (!course || course.id !== courseId) return;
    if (cacheCourseId.current !== course.id) {
      savedCmi.current.clear();
      cacheCourseId.current = course.id;
    }
    for (const stored of course.attempts ?? []) {
      if (!stored.cmi) continue;
      const local = savedCmi.current.get(stored.itemId);
      // Prefer in-memory snapshot when it already carries learner status.
      if (local) {
        const localNorm = normalizeCommit(local, course.version);
        if (
          localNorm.completion !== "not attempted" ||
          localNorm.success != null ||
          localNorm.lastLocation
        ) {
          continue;
        }
      }
      savedCmi.current.set(stored.itemId, stored.cmi);
    }
  }, [course, courseId]);

  useEffect(() => {
    if (!course || sequenced) return;
    if (!item) return;
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    let started = false;
    let closed = false;
    const version = course.version;
    const courseKey = course.id;
    const currentItemId = item.id;
    const saved = savedCmi.current.get(currentItemId) ?? attempt?.cmi ?? null;
    const opening = normalizeCommit(saved, version);
    setElapsed(0);
    setActiveItemId(currentItemId);
    setActiveTitle(item.title);
    setLive({
      completion: opening.completion,
      success: opening.success,
      scoreRaw: opening.scoreRaw,
    });
    const index = course.items.findIndex((entry) => entry.id === currentItemId);
    setNav({
      canPrevious: index > 0,
      canNext: index >= 0 && index < course.items.length - 1,
      hidePrevious: false,
      hideContinue: false,
    });
    const api = attachRuntime(version, courseKey, currentItemId, saved);
    const remember = (snapshot: Record<string, unknown>) => {
      savedCmi.current.set(currentItemId, snapshot);
      setCourse((current) =>
        current && current.id === courseKey
          ? withRememberedAttempt(current, currentItemId, snapshot)
          : current,
      );
    };
    const refresh = () => {
      const snapshot = api.renderCMIToJSONObject();
      if (closed) return snapshot;
      const normalized = normalizeCommit(snapshot, version);
      setLive({
        completion: normalized.completion,
        success: normalized.success,
        scoreRaw: normalized.scoreRaw,
      });
      return snapshot;
    };
    const publish = () => {
      remember(refresh());
    };
    const markStarted = () => {
      started = true;
    };
    api.on("Initialize", markStarted);
    api.on("LMSInitialize", markStarted);
    api.on("SetValue", refresh);
    api.on("LMSSetValue", refresh);
    api.on("Commit", publish);
    api.on("LMSCommit", publish);
    api.on("CommitSuccess", publish);
    const frame = frameRef.current;
    if (frame) frame.src = launchUrl(courseKey, item.href);
    return () => {
      closed = true;
      window.clearInterval(timer);
      if (started) remember(api.renderCMIToJSONObject());
      blankFrame();
      finishRuntime(api, version, started);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id, item?.id, course?.version, sequenced]);

  useEffect(() => {
    if (!course || !sequenced) return;
    let closed = false;
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    setElapsed(0);
    setNav({
      canPrevious: false,
      canNext: false,
      hidePrevious: false,
      hideContinue: false,
    });

    const firstItem = course.items[0];
    const resumeId = itemId || firstItem?.id || "";
    const initial =
      savedCmi.current.get(resumeId) ??
      course.attempts?.find((entry) => entry.itemId === resumeId)?.cmi ??
      null;

    const runtime = attachSequencedRuntime(course, {
      getLaunchUrl: (id, href) => launchUrl(course.id, href),
      getSavedCmi: (id) =>
        savedCmi.current.get(id) ??
        course.attempts?.find((entry) => entry.itemId === id)?.cmi ??
        null,
      initialCmi: initial,
      beforeActivityReset: () => {
        blankFrame();
      },
      onDelivery: (id, title, url) => {
        if (closed) return;
        deliveredIdRef.current = id;
        setActiveItemId(id);
        setActiveTitle(title);
        // blank → reset already ran in runtime when switching; now load the SCO
        const frame = frameRef.current;
        if (frame && url) frame.src = url;
        navigate(`/play/${encodeURIComponent(course.id)}/${encodeURIComponent(id)}`, true);
        const saved =
          savedCmi.current.get(id) ??
          course.attempts?.find((entry) => entry.itemId === id)?.cmi ??
          null;
        const attempt = course.attempts?.find((entry) => entry.itemId === id);
        if (saved) {
          const normalized = normalizeCommit(saved, "2004");
          setLive({
            completion:
              normalized.completion === "not attempted"
                ? (attempt?.completion ?? normalized.completion)
                : normalized.completion,
            success: normalized.success ?? attempt?.success ?? null,
            scoreRaw: normalized.scoreRaw ?? attempt?.scoreRaw ?? null,
          });
        } else if (attempt) {
          setLive({
            completion: attempt.completion,
            success: attempt.success,
            scoreRaw: attempt.scoreRaw,
          });
        } else {
          setLive({ completion: "not attempted", success: null, scoreRaw: null });
        }
        // Refresh attempt list so the outline shows prior SCO pass/complete.
        void getCourse(course.id)
          .then((fresh) => {
            if (closed) return;
            setCourse(fresh);
            const latest = fresh.attempts?.find((entry) => entry.itemId === id);
            if (!latest) return;
            setLive((current) => {
              if (current.success === "passed" || current.completion === "completed") {
                return current;
              }
              return {
                completion: latest.completion,
                success: latest.success,
                scoreRaw: latest.scoreRaw,
              };
            });
          })
          .catch(() => {
            /* keep in-memory course */
          });
      },
      onNavigation: (state) => {
        if (closed) return;
        setNav({
          canPrevious: state.canPrevious,
          canNext: state.canNext,
          hidePrevious: Boolean(state.hidePrevious),
          hideContinue: Boolean(state.hideContinue),
        });
      },
      onSessionEnd: () => {
        if (!closed) navigate("/");
      },
    });
    sequencedRef.current = runtime;

    const api = runtime.api;
    const remember = (itemKey: string, snapshot: Record<string, unknown>) => {
      savedCmi.current.set(itemKey, snapshot);
      setCourse((current) =>
        current && current.id === course.id
          ? withRememberedAttempt(current, itemKey, snapshot)
          : current,
      );
    };
    const refresh = () => {
      const snapshot = api.renderCMIToJSONObject();
      if (closed) return snapshot;
      const normalized = normalizeCommit(snapshot, "2004");
      setLive({
        completion: normalized.completion,
        success: normalized.success,
        scoreRaw: normalized.scoreRaw,
      });
      return snapshot;
    };
    const publish = () => {
      const currentId = deliveredIdRef.current || firstItem?.id;
      if (currentId) remember(currentId, refresh());
    };
    api.on("SetValue", refresh);
    api.on("Commit", publish);
    api.on("CommitSuccess", publish);

    void runtime.start();

    return () => {
      closed = true;
      window.clearInterval(timer);
      const currentId = deliveredIdRef.current || firstItem?.id;
      // Persist before blanking so unload does not race a cleared API.
      if (currentId) {
        try {
          if (api.isInitialized?.()) {
            remember(currentId, api.renderCMIToJSONObject());
          }
        } catch {
          /* ignore */
        }
      }
      runtime.suspendAndPersist();
      blankFrame();
      runtime.destroy();
      sequencedRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id, sequenced]);

  // Flat player: URL is source of truth. Sync active item from the route
  // (Next/Previous/outline), and only fill a missing itemId once.
  useEffect(() => {
    if (!course || sequenced) return;
    if (itemId) {
      if (itemId !== activeItemId) setActiveItemId(itemId);
      return;
    }
    const fallback = course.items[0];
    if (fallback) {
      navigate(
        `/play/${encodeURIComponent(course.id)}/${encodeURIComponent(fallback.id)}`,
        true,
      );
    }
  }, [course, sequenced, itemId, activeItemId]);

  if (error) {
    return (
      <main className="player-message">
        <p className="banner">{error}</p>
        <button className="primary" type="button" onClick={() => navigate("/")}>
          Back to courses
        </button>
      </main>
    );
  }
  if (!course || !item) return <main className="player-message">Loading course…</main>;

  const progress = courseProgress(course, item.id, live.completion);
  const stored = attempt ? totalSeconds(attempt) : 0;
  const displayTitle = activeTitle || item.title;
  const itemIndex = course.items.findIndex((entry) => entry.id === item.id);
  const hasEarlierItem = itemIndex > 0;
  const hasLaterItem = itemIndex >= 0 && itemIndex < course.items.length - 1;
  const attemptDone =
    attempt?.success === "passed" || attempt?.completion === "completed";
  const currentDone =
    live.success === "passed" ||
    live.completion === "completed" ||
    Boolean(attemptDone);
  // Sequenced: never Next until current is done. Previous stays available for
  // any earlier leaf (SN previous or choice) so Exit/skip cannot trap the learner.
  const previousEnabled = sequenced
    ? nav.canPrevious || hasEarlierItem
    : hasEarlierItem;
  const nextEnabled = sequenced ? nav.canNext && currentDone : hasLaterItem;

  return (
    <main className={outlineOpen ? "player" : "player outline-collapsed"}>
      <aside className="outline" aria-hidden={!outlineOpen}>
        <div className="outline-head">
          <p className="eyebrow">Course outline</p>
          <button
            className="outline-toggle quiet"
            type="button"
            onClick={() => setOutlineOpen(false)}
            aria-label="Hide outline"
          >
            Hide
          </button>
        </div>
        <h1>{course.title}</h1>
        {course.hasSequencing ? <p className="outline-note">Sequenced SCORM 2004</p> : null}
        <ol>
          {course.items.map((entry, entryIndex) => {
            const state = entry.id === item.id ? live.completion : completionFor(course, entry.id);
            const success = entry.id === item.id ? live.success : successFor(course, entry.id);
            const current = entry.id === item.id;
            const done = state === "completed" || success === "passed";
            // Sequenced outline: current, passed/completed, or any earlier leaf
            // already reached in the flow (so Exit after a skip is recoverable).
            const reachedEarlier = sequenced && entryIndex < itemIndex;
            const outlineEnabled = !sequenced || current || done || reachedEarlier;
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className={current ? "current" : ""}
                  data-status={done ? "completed" : state}
                  disabled={!outlineEnabled || (sequenced && current)}
                  onClick={() => {
                    if (sequenced) {
                      if (current) return;
                      if (!done && !reachedEarlier) return;
                      sequencedRef.current?.choose(entry.id);
                      return;
                    }
                    navigate(
                      `/play/${encodeURIComponent(course.id)}/${encodeURIComponent(entry.id)}`,
                    );
                  }}
                >
                  <span className="outline-index" data-status={done ? "completed" : state}>
                    {done ? "✓" : entryIndex + 1}
                  </span>
                  <span>
                    <strong>{entry.title}</strong>
                    <small>{statusLabel(state, success)}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
      <section className="stage">
        <div className="stage-bar">
          <div className="stage-bar-main">
            {!outlineOpen ? (
              <button
                className="quiet outline-show"
                type="button"
                onClick={() => setOutlineOpen(true)}
              >
                Outline
              </button>
            ) : null}
            <div>
              <p className="eyebrow">Now playing</p>
              <h2>{displayTitle}</h2>
            </div>
          </div>
          <div className="metrics">
            <span className="chip" data-status={live.completion}>
              {statusLabel(live.completion, live.success)}
            </span>
            <span className="metric-pill">
              {live.scoreRaw == null ? "Score —" : `Score ${live.scoreRaw}`}
            </span>
            <span className="metric-pill">{formatClock(stored + elapsed)}</span>
          </div>
          <div
            className="bar wide"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
        <iframe ref={frameRef} title={displayTitle} src="about:blank" />
        <footer className="stage-nav">
          {!nav.hidePrevious ? (
            <button
              className="quiet"
              type="button"
              disabled={!previousEnabled}
              onClick={() => {
                if (sequenced) {
                  if (nav.canPrevious) {
                    sequencedRef.current?.navigate("previous");
                    return;
                  }
                  const previous = hasEarlierItem ? course.items[itemIndex - 1] : null;
                  if (previous) sequencedRef.current?.choose(previous.id);
                  return;
                }
                const previous = hasEarlierItem ? course.items[itemIndex - 1] : null;
                if (previous) navigate(itemPath(course.id, previous.id));
              }}
            >
              Previous
            </button>
          ) : (
            <span />
          )}
          <button
            className="quiet"
            type="button"
            onClick={() => {
              if (sequenced) {
                const currentId = deliveredIdRef.current || item.id;
                const api = sequencedRef.current?.api;
                if (currentId && api?.isInitialized?.()) {
                  try {
                    savedCmi.current.set(currentId, api.renderCMIToJSONObject());
                    setCourse((current) =>
                      current && current.id === course.id
                        ? withRememberedAttempt(
                            current,
                            currentId,
                            savedCmi.current.get(currentId)!,
                          )
                        : current,
                    );
                  } catch {
                    /* ignore */
                  }
                }
                sequencedRef.current?.suspendAndPersist();
              }
              navigate("/");
            }}
          >
            Exit
          </button>
          {!nav.hideContinue ? (
            <button
              className="primary"
              type="button"
              disabled={!nextEnabled}
              onClick={() => {
                if (sequenced) {
                  if (!currentDone) return;
                  sequencedRef.current?.navigate("continue");
                  return;
                }
                const next = hasLaterItem ? course.items[itemIndex + 1] : null;
                if (next) navigate(itemPath(course.id, next.id));
              }}
            >
              Next
            </button>
          ) : (
            <span />
          )}
        </footer>
      </section>
    </main>
  );
}

function launchUrl(courseId: string, href: string): string {
  const [path, suffix] = splitHref(href);
  return `/content/${encodeURIComponent(courseId)}/${path.split("/").map(encodeURIComponent).join("/")}${suffix}`;
}

function splitHref(href: string): [string, string] {
  const cut = href.search(/[?#]/);
  if (cut < 0) return [href, ""];
  return [href.slice(0, cut), href.slice(cut)];
}

function itemPath(courseId: string, itemId: string): string {
  return `/play/${encodeURIComponent(courseId)}/${encodeURIComponent(itemId)}`;
}

function withRememberedAttempt(
  course: Course,
  itemId: string,
  cmi: Record<string, unknown>,
): Course {
  const normalized = normalizeCommit(cmi, course.version);
  const existing = course.attempts?.find((entry) => entry.itemId === itemId);
  const next: Attempt = {
    id: existing?.id ?? `${course.id}::${itemId}`,
    courseId: course.id,
    itemId,
    cmi,
    completion:
      normalized.completion === "not attempted"
        ? (existing?.completion ?? "not attempted")
        : normalized.completion,
    success: normalized.success ?? existing?.success ?? null,
    scoreRaw: normalized.scoreRaw ?? existing?.scoreRaw ?? null,
    scoreMin: normalized.scoreMin ?? existing?.scoreMin ?? null,
    scoreMax: normalized.scoreMax ?? existing?.scoreMax ?? null,
    progress: normalized.progress ?? existing?.progress ?? null,
    accumulatedSeconds: existing?.accumulatedSeconds ?? 0,
    pendingSessionSeconds: existing?.pendingSessionSeconds ?? 0,
    lastLocation: normalized.lastLocation || existing?.lastLocation || "",
    updatedAt: new Date().toISOString(),
  };
  const attempts = (course.attempts ?? []).filter((entry) => entry.itemId !== itemId).concat(next);
  return { ...course, attempts };
}

function attemptFor(course: Course, itemId: string): Attempt | undefined {
  return course.attempts?.find((attempt) => attempt.itemId === itemId);
}

function completionFor(course: Course, itemId: string): string {
  return attemptFor(course, itemId)?.completion ?? "not attempted";
}

function successFor(course: Course, itemId: string): "passed" | "failed" | null {
  return attemptFor(course, itemId)?.success ?? null;
}

function courseProgress(course: Course, currentId: string, currentCompletion: string): number {
  if (course.items.length === 0) return 0;
  const fraction = course.items.reduce((sum, entry) => {
    const completion = entry.id === currentId ? currentCompletion : completionFor(course, entry.id);
    const success = successFor(course, entry.id);
    if (completion === "completed" || success === "passed") return sum + 1;
    if (completion === "incomplete" || completion === "browsed") return sum + 0.45;
    return sum;
  }, 0);
  return Math.round((fraction / course.items.length) * 100);
}
