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

export type UploadProgress = { phase: "uploading"; percent: number } | { phase: "unpacking" };

export function uploadCourse(
  file: File,
  onProgress: (progress: UploadProgress) => void,
): Promise<Course> {
  const body = new FormData();
  body.set("package", file);
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/courses");
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress({ phase: "uploading", percent: Math.round((event.loaded / event.total) * 100) });
    };
    request.upload.onload = () => onProgress({ phase: "unpacking" });
    request.onload = () => {
      const response = request.response as (Course & { error?: string }) | null;
      if (request.status >= 200 && request.status < 300 && response) resolve(response);
      else reject(new Error(response?.error || "The upload failed."));
    };
    request.onerror = () => reject(new Error("The upload was interrupted."));
    request.send(body);
  });
}

export async function removeCourse(courseId: string): Promise<void> {
  const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await readError(response));
}

export async function resetCourse(courseId: string): Promise<void> {
  const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/reset`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(await readError(response));
}
