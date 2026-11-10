import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import { listCourses, removeCourse, resetCourse, uploadCourse } from "./api";
import { navigate } from "./App";
import { formatClock, statusLabel } from "../server/normalize";
import type { Course } from "./types";

export function Library() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function refresh() {
    setCourses(await listCourses());
  }

  useEffect(() => {
    refresh().catch((reason: unknown) => setError(message(reason)));
  }, []);

  async function accept(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const course = await uploadCourse(file);
      await refresh();
      navigate(playPath(course));
    } catch (reason) {
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    void accept(event.dataTransfer.files[0]);
  }

  async function onReset(course: Course) {
    setError("");
    try {
      if (course.builtin) await resetCourse(course.id);
      else await removeCourse(course.id);
      await refresh();
    } catch (reason) {
      setError(message(reason));
    }
  }

  return (
    <main className="library">
      <div className="library-intro">
        <h1>Courses</h1>
        <p>Upload a SCORM 1.2 or 2004 package. Progress, score, and time stay on this player.</p>
      </div>
      <label
        className={dragging ? "dropzone dragging" : "dropzone"}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept=".zip,application/zip"
          disabled={busy}
          onChange={(event: FormEvent<HTMLInputElement>) => {
            const input = event.currentTarget;
            void accept(input.files?.[0]);
            input.value = "";
          }}
        />
        <strong>{busy ? "Checking package…" : "Drop a SCORM ZIP here"}</strong>
        <span>or choose a file. The manifest must sit at the root of the archive.</span>
      </label>
      {error ? <p className="banner">{error}</p> : null}
      <section className="cards" aria-label="Course library">
        {courses.map((course) => (
          <article className="card" key={course.id}>
            <div className="card-top">
              <span className="chip" data-status={course.summary.completion}>{statusLabel(course.summary.completion, course.summary.success)}</span>
              <span className="version">SCORM {course.version}</span>
            </div>
            <h2>{course.title}</h2>
            <p className="meta">
              {course.items.length} {course.items.length === 1 ? "lesson" : "lessons"}
              {course.builtin ? " · Sample" : ""}
            </p>
            <div className="bar" aria-hidden="true">
              <span style={{ width: `${course.summary.progress}%` }} />
            </div>
            <p className="stats">
              <span>{course.summary.progress}% complete</span>
              <span>{course.summary.scoreRaw == null ? "No score" : `Score ${course.summary.scoreRaw}`}</span>
              <span>{formatClock(course.summary.timeSeconds)}</span>
            </p>
            {course.warnings.length > 0 ? <p className="warning">{course.warnings[0]}</p> : null}
            <div className="card-actions">
              <button className="primary" type="button" onClick={() => navigate(playPath(course))}>
                Open
              </button>
              <button className="quiet" type="button" onClick={() => void onReset(course)}>
                {course.builtin ? "Reset progress" : "Remove"}
              </button>
            </div>
          </article>
        ))}
      </section>
      <p className="trust">Uploaded packages run on this origin. Upload only content you trust.</p>
    </main>
  );
}

function playPath(course: Course): string {
  const item = course.items[0];
  if (!item) return `/play/${encodeURIComponent(course.id)}`;
  return `/play/${encodeURIComponent(course.id)}/${encodeURIComponent(item.id)}`;
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Something went wrong.";
}
