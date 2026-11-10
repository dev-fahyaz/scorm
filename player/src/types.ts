export type CourseItem = {
  id: string;
  title: string;
  href: string;
};

export type Attempt = {
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

export type Summary = {
  completion: string;
  success: "passed" | "failed" | null;
  scoreRaw: number | null;
  timeSeconds: number;
  progress: number;
};

export type Course = {
  id: string;
  title: string;
  version: "1.2" | "2004";
  items: CourseItem[];
  warnings: string[];
  builtin: boolean;
  createdAt: string;
  summary: Summary;
  attempts?: Attempt[];
};
