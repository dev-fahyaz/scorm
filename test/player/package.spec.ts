import { strToU8, zipSync } from "fflate";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PackageError, extractPackage, openZip } from "../../player/server/package";
import {
  cmiForResume,
  nextTime,
  normalizeCommit,
  parseIsoDuration,
  parseScorm12Time,
} from "../../player/server/normalize";

const manifest12 = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="course" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org">
    <organization identifier="org">
      <title>Safety briefing</title>
      <item identifier="lesson" identifierref="res">
        <title>Welcome</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`;

let workDir = "";

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "aspire-player-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function zip(files: Record<string, string | Uint8Array>): string {
  const zipPath = path.join(workDir, `package-${Math.random().toString(16).slice(2)}.zip`);
  const entries = Object.fromEntries(
    Object.entries(files).map(([name, content]) => [
      name,
      typeof content === "string" ? strToU8(content) : content,
    ]),
  );
  writeFileSync(zipPath, zipSync(entries, { level: 9 }));
  return zipPath;
}

function parsePackage(zipPath: string) {
  return extractPackage(zipPath, path.join(workDir, "content"));
}

describe("SCORM package import", () => {
  it("reads the version, title, and launch file, and extracts it to disk", async () => {
    const parsed = await parsePackage(
      zip({ "imsmanifest.xml": manifest12, "index.html": "<html></html>" }),
    );
    expect(parsed.version).toBe("1.2");
    expect(parsed.title).toBe("Safety briefing");
    expect(parsed.items).toEqual([{ id: "lesson", title: "Welcome", href: "index.html" }]);
    expect(parsed.warnings).toEqual([]);
    expect(readFileSync(path.join(workDir, "content", "index.html"), "utf8")).toBe("<html></html>");
  });

  it("imports packages with thousands of files", async () => {
    const files: Record<string, string> = {
      "imsmanifest.xml": manifest12,
      "index.html": "<html></html>",
    };
    for (let index = 0; index < 2500; index += 1)
      files[`assets/file-${index}.txt`] = `asset ${index}`;
    const parsed = await parsePackage(zip(files));
    expect(parsed.items).toHaveLength(1);
    expect(existsSync(path.join(workDir, "content", "assets", "file-2499.txt"))).toBe(true);
  }, 60_000);

  it("rejects entries that look like a ZIP bomb", async () => {
    const bomb = new Uint8Array(20 * 1024 * 1024);
    await expect(
      parsePackage(
        zip({ "imsmanifest.xml": manifest12, "index.html": "<html></html>", "bomb.bin": bomb }),
      ),
    ).rejects.toThrow(/ZIP bomb/);
  });

  it("rejects a file that is not a ZIP", async () => {
    const notZip = path.join(workDir, "not-a-zip.zip");
    writeFileSync(notZip, "plain text");
    await expect(parsePackage(notZip)).rejects.toThrow(/not a valid ZIP/);
  });

  it("detects SCORM 2004 and warns about sequencing", async () => {
    const xml = manifest12
      .replace(
        "<schemaversion>1.2</schemaversion>",
        "<schemaversion>2004 4th Edition</schemaversion>",
      )
      .replace(
        "<title>Welcome</title>",
        '<title>Welcome</title><sequencing><controlMode choice="true"/></sequencing>',
      );
    const parsed = await parsePackage(
      zip({ "imsmanifest.xml": xml, "index.html": "<html></html>" }),
    );
    expect(parsed.version).toBe("2004");
    expect(parsed.warnings.some((warning) => warning.includes("sequencing"))).toBe(true);
  });

  it("rejects a package with no manifest at the root before extracting", async () => {
    await expect(parsePackage(zip({ "course/imsmanifest.xml": manifest12 }))).rejects.toThrow(
      PackageError,
    );
    await expect(parsePackage(zip({ "index.html": "<html></html>" }))).rejects.toThrow(
      /no imsmanifest\.xml at the ZIP root/,
    );
    expect(existsSync(path.join(workDir, "content"))).toBe(false);
  });

  it("rejects paths that escape the archive", async () => {
    await expect(openZip(zip({ "../secret.txt": "nope" }))).rejects.toThrow(/escapes the archive/);
    await expect(openZip(zip({ "/etc/passwd": "nope" }))).rejects.toThrow(/absolute path/);
  });

  it("warns when a referenced file is missing but the launch file exists", async () => {
    const xml = manifest12.replace(
      '<file href="index.html"/>',
      '<file href="index.html"/><file href="missing.js"/>',
    );
    const parsed = await parsePackage(
      zip({ "imsmanifest.xml": xml, "index.html": "<html></html>" }),
    );
    expect(parsed.warnings.some((warning) => warning.includes("missing.js"))).toBe(true);
    expect(parsed.items).toHaveLength(1);
  });
});

describe("attempt normalisation", () => {
  it("maps SCORM 1.2 status, score, and time", () => {
    const normalized = normalizeCommit(
      {
        cmi: {
          core: {
            lesson_status: "passed",
            lesson_location: "42",
            session_time: "0000:01:05.00",
            score: { raw: "80", min: "0", max: "100" },
          },
        },
      },
      "1.2",
    );
    expect(normalized.completion).toBe("completed");
    expect(normalized.success).toBe("passed");
    expect(normalized.scoreRaw).toBe(80);
    expect(normalized.lastLocation).toBe("42");
    expect(normalized.sessionSeconds).toBe(65);
  });

  it("maps SCORM 2004 progress and duration", () => {
    const normalized = normalizeCommit(
      {
        cmi: {
          completion_status: "incomplete",
          success_status: "unknown",
          progress_measure: "0.4",
          location: "12",
          session_time: "PT1M30S",
        },
      },
      "2004",
    );
    expect(normalized.completion).toBe("incomplete");
    expect(normalized.success).toBeNull();
    expect(normalized.progress).toBeCloseTo(0.4);
    expect(normalized.sessionSeconds).toBe(90);
    expect(parseIsoDuration("PT0H5M30S")).toBe(330);
    expect(parseScorm12Time("00:00:01.5")).toBe(1.5);
  });

  it("adds session time once, on terminate", () => {
    const pending = nextTime({ accumulatedSeconds: 10, pendingSessionSeconds: 0 }, 30, false);
    expect(pending).toEqual({ accumulatedSeconds: 10, pendingSessionSeconds: 30 });
    const done = nextTime(pending, 30, true);
    expect(done).toEqual({ accumulatedSeconds: 40, pendingSessionSeconds: 0 });
  });

  it("restores a bookmark without replaying the previous session time", () => {
    const restored = cmiForResume(
      {
        cmi: {
          core: { lesson_location: "15", session_time: "0000:00:15.00", student_id: "learner" },
        },
      },
      "1.2",
    );
    const cmi = restored.cmi as { core: Record<string, string> };
    expect(cmi.core.lesson_location).toBe("15");
    expect(cmi.core.entry).toBe("resume");
    expect(cmi.core.session_time).toBeUndefined();
    expect(cmi.core.student_id).toBe("learner");
  });
});
