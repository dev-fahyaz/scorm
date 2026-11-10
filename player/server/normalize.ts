export type ScormVersion = "1.2" | "2004";

export type NormalizedCommit = {
  completion: string;
  success: "passed" | "failed" | null;
  scoreRaw: number | null;
  scoreMin: number | null;
  scoreMax: number | null;
  progress: number | null;
  lastLocation: string;
  sessionSeconds: number;
};

export type TimeState = {
  accumulatedSeconds: number;
  pendingSessionSeconds: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function cmiOf(commit: unknown): Record<string, unknown> {
  const root = asRecord(commit);
  const nested = asRecord(root.cmi);
  return Object.keys(nested).length > 0 ? nested : root;
}

export function parseScorm12Time(value: string): number {
  const match = /^(\d+):(\d{2}):(\d{2})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4] ? Number(match[4].padEnd(2, "0")) / 100 : 0;
  return hours * 3600 + minutes * 60 + seconds + fraction;
}

export function parseIsoDuration(value: string): number {
  const match =
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
      value.trim(),
    );
  if (!match || !value.trim().toUpperCase().startsWith("P")) return 0;
  const days = Number(match[3] || 0);
  const hours = Number(match[4] || 0);
  const minutes = Number(match[5] || 0);
  const seconds = Number(match[6] || 0);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function clampProgress(value: number | null): number | null {
  if (value == null) return null;
  return Math.min(1, Math.max(0, value));
}

export function normalizeCommit(commit: unknown, version: ScormVersion): NormalizedCommit {
  const cmi = cmiOf(commit);
  if (version === "1.2") {
    const core = asRecord(cmi.core);
    const score = asRecord(core.score);
    const lessonStatus = text(core.lesson_status).toLowerCase();
    let completion = "not attempted";
    let success: NormalizedCommit["success"] = null;
    if (lessonStatus === "passed" || lessonStatus === "failed" || lessonStatus === "completed") {
      completion = "completed";
      if (lessonStatus === "passed" || lessonStatus === "failed") success = lessonStatus;
    } else if (lessonStatus === "incomplete" || lessonStatus === "browsed") {
      completion = lessonStatus;
    }
    return {
      completion,
      success,
      scoreRaw: numberOrNull(score.raw),
      scoreMin: numberOrNull(score.min),
      scoreMax: numberOrNull(score.max),
      progress: null,
      lastLocation: text(core.lesson_location),
      sessionSeconds: parseScorm12Time(text(core.session_time)),
    };
  }

  const score = asRecord(cmi.score);
  const completionStatus = text(cmi.completion_status).toLowerCase() || "not attempted";
  const successStatus = text(cmi.success_status).toLowerCase();
  return {
    completion: completionStatus,
    success: successStatus === "passed" || successStatus === "failed" ? successStatus : null,
    scoreRaw: numberOrNull(score.raw),
    scoreMin: numberOrNull(score.min),
    scoreMax: numberOrNull(score.max),
    progress: clampProgress(numberOrNull(cmi.progress_measure)),
    lastLocation: text(cmi.location),
    sessionSeconds: parseIsoDuration(text(cmi.session_time)),
  };
}

export function nextTime(state: TimeState, sessionSeconds: number, terminate: boolean): TimeState {
  const reported = sessionSeconds > 0 ? sessionSeconds : state.pendingSessionSeconds;
  if (!terminate) {
    return { accumulatedSeconds: state.accumulatedSeconds, pendingSessionSeconds: reported };
  }
  return {
    accumulatedSeconds: state.accumulatedSeconds + reported,
    pendingSessionSeconds: 0,
  };
}

export function totalSeconds(state: TimeState): number {
  return state.accumulatedSeconds + state.pendingSessionSeconds;
}

export function formatClock(total: number): string {
  const seconds = Math.max(0, Math.floor(total));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const clock = `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${clock}` : clock;
}

export function statusLabel(completion: string, success: "passed" | "failed" | null): string {
  if (success === "passed") return "Passed";
  if (success === "failed") return "Failed";
  if (completion === "completed") return "Completed";
  if (completion === "incomplete" || completion === "browsed") return "In progress";
  return "Not started";
}

export function cmiForResume(commit: unknown, version: ScormVersion): Record<string, unknown> {
  const cmi: Record<string, unknown> = structuredClone(cmiOf(commit));
  if (version === "1.2") {
    const core = asRecord(cmi.core);
    delete core.session_time;
    delete core.total_time;
    const location = text(core.lesson_location);
    const suspend = text(cmi.suspend_data);
    core.entry = location || suspend ? "resume" : "ab-initio";
    core.student_id = text(core.student_id) || "aspire-learner";
    core.student_name = text(core.student_name) || "Learner, Aspire";
    core.credit = text(core.credit) || "credit";
    core.lesson_mode = text(core.lesson_mode) || "normal";
    cmi.core = core;
    return { cmi };
  }

  delete cmi.session_time;
  delete cmi.total_time;
  const location = text(cmi.location);
  const suspend = text(cmi.suspend_data);
  cmi.entry = location || suspend ? "resume" : "ab-initio";
  cmi.learner_id = text(cmi.learner_id) || "aspire-learner";
  cmi.learner_name = text(cmi.learner_name) || "Aspire Learner";
  cmi.credit = text(cmi.credit) || "credit";
  cmi.mode = text(cmi.mode) || "normal";
  return { cmi };
}
