import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  PackageError,
  parseManifest,
  parsePackage,
  type CourseItem,
  type ParsedPackage,
} from "./package";
import {
  cmiOf,
  nextTime,
  normalizeCommit,
  totalSeconds,
  type ScormVersion,
} from "./normalize";

export const SAMPLE_COURSE_ID = "aspire-sample";

export type CourseRecord = ParsedPackage & {
  id: string;
  builtin: boolean;
  createdAt: string;
};

export type AttemptRecord = {
  id: string;
  courseId: string;
  itemId: string;
  cmi: Record<string, unknown> | null;
  completion: string;
  success: "passed" | "failed" | null;
  scoreRaw: number | null;
  scoreMin: number | null;
  scoreMax: number | null;
  progress: number | null;
  accumulatedSeconds: number;
  pendingSessionSeconds: number;
  lastLocation: string;
  updatedAt: string | null;
};

export type CourseSummary = {
  completion: string;
  success: "passed" | "failed" | null;
  scoreRaw: number | null;
  timeSeconds: number;
  progress: number;
};

type Database = {
  courses: CourseRecord[];
  attempts: AttemptRecord[];
};

function emptyAttempt(courseId: string, itemId: string): AttemptRecord {
  return {
    id: attemptId(courseId, itemId),
    courseId,
    itemId,
    cmi: null,
    completion: "not attempted",
    success: null,
    scoreRaw: null,
    scoreMin: null,
    scoreMax: null,
    progress: null,
    accumulatedSeconds: 0,
    pendingSessionSeconds: 0,
    lastLocation: "",
    updatedAt: null,
  };
}

export function attemptId(courseId: string, itemId: string): string {
  return `${courseId}::${itemId}`;
}

export function parseAttemptId(id: string): { courseId: string; itemId: string } | null {
  const index = id.indexOf("::");
  if (index <= 0) return null;
  return { courseId: id.slice(0, index), itemId: id.slice(index + 2) };
}

export function summarize(course: CourseRecord, attempts: AttemptRecord[]): CourseSummary {
  const relevant = course.items.map(
    (item) => attempts.find((attempt) => attempt.itemId === item.id) ?? emptyAttempt(course.id, item.id),
  );
  const done = relevant.filter((attempt) => attempt.completion === "completed").length;
  const started = relevant.some(
    (attempt) => attempt.updatedAt && attempt.completion !== "not attempted",
  );
  const single = relevant.length === 1 ? relevant[0] : undefined;
  let progress = relevant.length === 0 ? 0 : Math.round((done / relevant.length) * 100);
  if (single?.progress != null && single.completion !== "completed") {
    progress = Math.round(single.progress * 100);
  }
  const scores = relevant.map((attempt) => attempt.scoreRaw).filter((score): score is number => score != null);
  const success = relevant.some((attempt) => attempt.success === "failed")
    ? "failed"
    : relevant.some((attempt) => attempt.success === "passed")
      ? "passed"
      : null;
  let completion = "not attempted";
  if (relevant.length > 0 && done === relevant.length) completion = "completed";
  else if (started) completion = "incomplete";
  return {
    completion,
    success,
    scoreRaw: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    timeSeconds: relevant.reduce((sum, attempt) => sum + totalSeconds(attempt), 0),
    progress,
  };
}

export class CourseStore {
  private readonly file: string;

  constructor(
    private readonly dataDir: string,
    private readonly sampleDir: string,
  ) {
    this.file = path.join(dataDir, "catalog.json");
    mkdirSync(dataDir, { recursive: true });
    this.ensureSample();
  }

  contentRoot(courseId: string): string | null {
    const course = this.get(courseId);
    if (!course) return null;
    return course.builtin ? this.sampleDir : path.join(this.dataDir, "content", course.id);
  }

  list(): Array<CourseRecord & { summary: CourseSummary }> {
    const db = this.read();
    return db.courses.map((course) => ({
      ...course,
      summary: summarize(
        course,
        db.attempts.filter((attempt) => attempt.courseId === course.id),
      ),
    }));
  }

  get(courseId: string): (CourseRecord & { summary: CourseSummary; attempts: AttemptRecord[] }) | null {
    const db = this.read();
    const course = db.courses.find((item) => item.id === courseId);
    if (!course) return null;
    const attempts = db.attempts.filter((attempt) => attempt.courseId === courseId);
    return { ...course, attempts, summary: summarize(course, attempts) };
  }

  importZip(data: Uint8Array): CourseRecord & { summary: CourseSummary } {
    const parsed = parsePackage(data);
    const id = `course-${randomBytes(8).toString("hex")}`;
    const course = this.writeCourse(id, parsed, false);
    const root = path.join(this.dataDir, "content", id);
    mkdirSync(root, { recursive: true });
    try {
      for (const [name, bytes] of parsed.files) {
        const destination = safeJoin(root, name);
        mkdirSync(path.dirname(destination), { recursive: true });
        writeFileSync(destination, bytes);
      }
    } catch (error) {
      rmSync(root, { recursive: true, force: true });
      this.removeCourseRecord(id);
      throw error instanceof PackageError ? error : new PackageError("The package could not be stored.");
    }
    return { ...course, summary: summarize(course, []) };
  }

  remove(courseId: string): boolean {
    const course = this.get(courseId);
    if (!course || course.builtin) return false;
    rmSync(path.join(this.dataDir, "content", courseId), { recursive: true, force: true });
    const db = this.read();
    db.courses = db.courses.filter((item) => item.id !== courseId);
    db.attempts = db.attempts.filter((attempt) => attempt.courseId !== courseId);
    this.write(db);
    return true;
  }

  reset(courseId: string): boolean {
    if (!this.get(courseId)) return false;
    const db = this.read();
    db.attempts = db.attempts.filter((attempt) => attempt.courseId !== courseId);
    this.write(db);
    return true;
  }

  commit(
    id: string,
    body: unknown,
    terminate: boolean,
  ): AttemptRecord {
    const parsed = parseAttemptId(id);
    if (!parsed) throw new PackageError("Unknown attempt.");
    const db = this.read();
    const course = db.courses.find((item) => item.id === parsed.courseId);
    const item = course?.items.find((entry) => entry.id === parsed.itemId);
    if (!course || !item) throw new PackageError("Unknown attempt.");

    const existing =
      db.attempts.find((attempt) => attempt.id === id) ?? emptyAttempt(parsed.courseId, parsed.itemId);
    const normalized = normalizeCommit(body, course.version);
    const time = nextTime(existing, normalized.sessionSeconds, terminate);
    const cmi = cmiOf(body);
    const next: AttemptRecord = {
      ...existing,
      cmi: Object.keys(cmi).length > 0 ? cmi : existing.cmi,
      completion: normalized.completion === "not attempted" ? existing.completion : normalized.completion,
      success: normalized.success ?? existing.success,
      scoreRaw: normalized.scoreRaw ?? existing.scoreRaw,
      scoreMin: normalized.scoreMin ?? existing.scoreMin,
      scoreMax: normalized.scoreMax ?? existing.scoreMax,
      progress: normalized.progress ?? existing.progress,
      accumulatedSeconds: time.accumulatedSeconds,
      pendingSessionSeconds: time.pendingSessionSeconds,
      lastLocation: normalized.lastLocation || existing.lastLocation,
      updatedAt: new Date().toISOString(),
    };
    db.attempts = db.attempts.filter((attempt) => attempt.id !== id).concat(next);
    this.write(db);
    return next;
  }

  private ensureSample(): void {
    const manifestPath = path.join(this.sampleDir, "imsmanifest.xml");
    if (!existsSync(manifestPath)) return;
    const db = this.read();
    if (db.courses.some((course) => course.id === SAMPLE_COURSE_ID)) return;
    const xml = readFileSync(manifestPath, "utf8");
    const names = ["imsmanifest.xml", "index.html"];
    const parsed = parseManifest(xml, names);
    db.courses.unshift(this.record(SAMPLE_COURSE_ID, parsed, true));
    this.write(db);
  }

  private writeCourse(id: string, parsed: ParsedPackage, builtin: boolean): CourseRecord {
    const db = this.read();
    const record = this.record(id, parsed, builtin);
    db.courses.push(record);
    this.write(db);
    return record;
  }

  private removeCourseRecord(id: string): void {
    const db = this.read();
    db.courses = db.courses.filter((course) => course.id !== id);
    this.write(db);
  }

  private record(id: string, parsed: ParsedPackage, builtin: boolean): CourseRecord {
    return {
      id,
      title: parsed.title,
      version: parsed.version as ScormVersion,
      items: parsed.items,
      warnings: parsed.warnings,
      builtin,
      createdAt: new Date().toISOString(),
    };
  }

  private read(): Database {
    if (!existsSync(this.file)) return { courses: [], attempts: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Database;
      return {
        courses: Array.isArray(parsed.courses) ? parsed.courses : [],
        attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
      };
    } catch {
      return { courses: [], attempts: [] };
    }
  }

  private write(db: Database): void {
    mkdirSync(this.dataDir, { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(db, null, 2));
    rmSync(this.file, { force: true });
    renameSync(temporary, this.file);
  }
}

function safeJoin(root: string, name: string): string {
  const destination = path.resolve(root, ...name.split("/"));
  const base = path.resolve(root);
  if (destination !== base && !destination.startsWith(base + path.sep)) {
    throw new PackageError(`The package contains an unsafe path: ${name}`);
  }
  return destination;
}

export type { CourseItem };
