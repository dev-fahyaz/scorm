import type { Course } from "./types";

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* The server sent an empty or non-JSON error. */
  }
  return "The request failed.";
}

export async function listCourses(): Promise<Course[]> {
  const response = await fetch("/api/courses");
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as Course[];
}

export async function getCourse(courseId: string): Promise<Course> {
  const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}`);
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as Course;
}

export async function uploadCourse(file: File): Promise<Course> {
  const body = new FormData();
  body.set("package", file);
  const response = await fetch("/api/courses", { method: "POST", body });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as Course;
}

export async function removeCourse(courseId: string): Promise<void> {
  const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await readError(response));
}

export async function resetCourse(courseId: string): Promise<void> {
  const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/reset`, { method: "POST" });
  if (!response.ok) throw new Error(await readError(response));
}
