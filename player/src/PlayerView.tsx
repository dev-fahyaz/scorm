import { useEffect, useRef, useState } from "react";
import { getCourse } from "./api";
import { navigate } from "./App";
import { formatClock, normalizeCommit, statusLabel, totalSeconds } from "../server/normalize";
import { attachRuntime, finishRuntime } from "./runtime";
import type { Attempt, Course } from "./types";

export function PlayerView({ courseId, itemId }: { courseId: string; itemId: string | null }) {
  const [course, setCourse] = useState<Course | null>(null);
  const [error, setError] = useState("");
  const [live, setLive] = useState({
    completion: "not attempted",
    success: null as "passed" | "failed" | null,
    scoreRaw: null as number | null,
  });
  const [elapsed, setElapsed] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);

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

  const item = course?.items.find((entry) => entry.id === itemId) ?? course?.items[0] ?? null;
  const attempt = course?.attempts?.find((entry) => entry.itemId === item?.id) ?? null;

  useEffect(() => {
    if (!course || !item) return;
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    let started = false;
    const api = attachRuntime(course.version, course.id, item.id, attempt?.cmi ?? null);
    const refresh = () => {
      const normalized = normalizeCommit(api.renderCMIToJSONObject(), course.version);
      setLive({
        completion: normalized.completion,
        success: normalized.success,
        scoreRaw: normalized.scoreRaw,
      });
    };
    const markStarted = () => {
      started = true;
    };
    api.on("Initialize", markStarted);
    api.on("LMSInitialize", markStarted);
    api.on("SetValue", refresh);
    api.on("LMSSetValue", refresh);
    api.on("Commit", refresh);
    api.on("LMSCommit", refresh);
    api.on("CommitSuccess", refresh);
    const frame = frameRef.current;
    if (frame) frame.src = launchUrl(course.id, item.href);
    return () => {
      window.clearInterval(timer);
      finishRuntime(api, course.version, started);
    };
    // The attempt captured at launch is the resume snapshot. Later commits must not reload the SCO.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id, item?.id, course?.version]);

  useEffect(() => {
    if (!course || !item || itemId === item.id) return;
    navigate(`/play/${encodeURIComponent(course.id)}/${encodeURIComponent(item.id)}`);
  }, [course, item, itemId]);

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

  const index = course.items.findIndex((entry) => entry.id === item.id);
  const previous = index > 0 ? course.items[index - 1] : null;
  const next = index >= 0 && index < course.items.length - 1 ? course.items[index + 1] : null;
  const progress = courseProgress(course, item.id, live.completion);
  const stored = attempt ? totalSeconds(attempt) : 0;

  return (
    <main className="player">
      <aside className="outline">
        <p className="eyebrow">Course outline</p>
        <h1>{course.title}</h1>
        <ol>
          {course.items.map((entry, entryIndex) => {
            const state = entry.id === item.id ? live.completion : completionFor(course, entry.id);
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className={entry.id === item.id ? "current" : ""}
                  onClick={() =>
                    navigate(
                      `/play/${encodeURIComponent(course.id)}/${encodeURIComponent(entry.id)}`,
                    )
                  }
                >
                  <span>{entryIndex + 1}</span>
                  <span>
                    <strong>{entry.title}</strong>
                    <small>
                      {statusLabel(
                        state,
                        entry.id === item.id ? live.success : successFor(course, entry.id),
                      )}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
      <section className="stage">
        <div className="stage-bar">
          <div>
            <p className="eyebrow">Now playing</p>
            <h2>{item.title}</h2>
          </div>
          <div className="metrics">
            <span className="chip" data-status={live.completion}>
              {statusLabel(live.completion, live.success)}
            </span>
            <span>{live.scoreRaw == null ? "Score —" : `Score ${live.scoreRaw}`}</span>
            <span>{formatClock(stored + elapsed)}</span>
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
        <iframe ref={frameRef} title={item.title} src="about:blank" />
        <footer className="stage-nav">
          <button
            className="quiet"
            type="button"
            disabled={!previous}
            onClick={() => previous && navigate(itemPath(course.id, previous.id))}
          >
            Previous
          </button>
          <button className="quiet" type="button" onClick={() => navigate("/")}>
            Exit
          </button>
          <button
            className="primary"
            type="button"
            disabled={!next}
            onClick={() => next && navigate(itemPath(course.id, next.id))}
          >
            Next
          </button>
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
  const fraction = course.items.reduce((sum, item) => {
    const completion = item.id === currentId ? currentCompletion : completionFor(course, item.id);
    if (completion === "completed") return sum + 1;
    if (completion === "incomplete" || completion === "browsed") return sum + 0.45;
    return sum;
  }, 0);
  return Math.round((fraction / course.items.length) * 100);
}
