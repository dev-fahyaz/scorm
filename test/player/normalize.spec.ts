import { describe, expect, it } from "vitest";
import { cmiOf, normalizeCommit } from "../../player/server/normalize";

describe("cmiOf / normalizeCommit", () => {
  it("reads nested cmi from a flat commit", () => {
    const cmi = cmiOf({
      cmi: {
        completion_status: "completed",
        success_status: "passed",
        session_time: "PT1M",
      },
    });
    expect(cmi.completion_status).toBe("completed");
    expect(cmi.success_status).toBe("passed");
  });

  it("unwraps structured CommitObject runtimeData.cmi", () => {
    const body = {
      completionStatus: "incomplete",
      successStatus: "unknown",
      runtimeData: {
        cmi: {
          completion_status: "completed",
          success_status: "passed",
          score: { raw: 90 },
          session_time: "PT45S",
          location: "slide-3",
        },
      },
    };
    const cmi = cmiOf(body);
    expect(cmi.completion_status).toBe("completed");
    expect(cmi.success_status).toBe("passed");
    expect(cmi.location).toBe("slide-3");

    const normalized = normalizeCommit(body, "2004");
    expect(normalized.completion).toBe("completed");
    expect(normalized.success).toBe("passed");
    expect(normalized.scoreRaw).toBe(90);
    expect(normalized.sessionSeconds).toBe(45);
    expect(normalized.lastLocation).toBe("slide-3");
  });

  it("does not treat the CommitObject envelope as CMI", () => {
    const cmi = cmiOf({
      completionStatus: "completed",
      successStatus: "passed",
      runtimeData: {},
      activityId: "item_1",
    });
    expect(cmi).toEqual({});
    const normalized = normalizeCommit(
      {
        completionStatus: "completed",
        successStatus: "passed",
        runtimeData: {},
      },
      "2004",
    );
    expect(normalized.completion).toBe("not attempted");
    expect(normalized.success).toBeNull();
  });
});
