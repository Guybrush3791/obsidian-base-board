import { describe, expect, it } from "vitest";
import {
  assignLanes,
  buildMonthGrid,
  formatMinutes,
  parseCardDate,
  shiftMonth,
} from "../src/calendar-utils";

describe("parseCardDate", () => {
  it("parses a local date-time as wall-clock time", () => {
    expect(parseCardDate("2026-10-13T22:00:00")).toEqual({
      dateKey: "2026-10-13",
      minutes: 22 * 60,
    });
    expect(parseCardDate("2026-10-13 09:30")).toEqual({
      dateKey: "2026-10-13",
      minutes: 9 * 60 + 30,
    });
  });

  it("treats a date without time as all-day", () => {
    expect(parseCardDate("2026-10-05")).toEqual({
      dateKey: "2026-10-05",
      minutes: null,
    });
  });

  it("converts zoned values to local time", () => {
    const expected = new Date("2026-10-13T20:15:00Z");
    expect(parseCardDate("2026-10-13T20:15:00Z")).toEqual({
      dateKey: `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, "0")}-${String(expected.getDate()).padStart(2, "0")}`,
      minutes: expected.getHours() * 60 + expected.getMinutes(),
    });
  });

  it("rejects invalid or non-date values", () => {
    expect(parseCardDate("2026-02-30")).toBeNull();
    expect(parseCardDate("2026-13-01")).toBeNull();
    expect(parseCardDate("2026-10-13T24:00:00")).toBeNull();
    expect(parseCardDate("3 days ago")).toBeNull();
    expect(parseCardDate("")).toBeNull();
    expect(parseCardDate(42)).toBeNull();
    expect(parseCardDate(null)).toBeNull();
    expect(parseCardDate(new Date("nope"))).toBeNull();
  });

  it("accepts leap days", () => {
    expect(parseCardDate("2028-02-29")?.dateKey).toBe("2028-02-29");
    expect(parseCardDate("2026-02-29")).toBeNull();
  });
});

describe("buildMonthGrid", () => {
  it("lays out October 2026 starting on Monday", () => {
    const weeks = buildMonthGrid(2026, 9, 1);
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0]).toBe("2026-09-28");
    expect(weeks[0][3]).toBe("2026-10-01");
    expect(weeks[4][6]).toBe("2026-11-01");
  });

  it("respects a Sunday week start", () => {
    const weeks = buildMonthGrid(2026, 9, 0);
    expect(weeks[0][0]).toBe("2026-09-27");
    expect(weeks[0][4]).toBe("2026-10-01");
  });

  it("produces six weeks when the month needs them", () => {
    // August 2026 starts on a Saturday.
    const weeks = buildMonthGrid(2026, 7, 1);
    expect(weeks).toHaveLength(6);
    expect(weeks[5][0]).toBe("2026-08-31");
  });
});

describe("shiftMonth", () => {
  it("wraps across years", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth(2026, 9, 0)).toEqual({ year: 2026, month: 9 });
  });
});

describe("formatMinutes", () => {
  it("pads hours and minutes", () => {
    expect(formatMinutes(0)).toBe("00:00");
    expect(formatMinutes(9 * 60 + 5)).toBe("09:05");
    expect(formatMinutes(22 * 60)).toBe("22:00");
  });
});

describe("assignLanes", () => {
  it("keeps non-overlapping events full width", () => {
    expect(assignLanes([9 * 60, 22 * 60])).toEqual([
      { lane: 0, lanes: 1 },
      { lane: 0, lanes: 1 },
    ]);
  });

  it("splits overlapping events side by side", () => {
    // 10:00 and 10:30 overlap; 11:20 reuses lane 0 (free since 11:00) but
    // still overlaps 10:30, so all three share the two-lane split.
    expect(assignLanes([600, 630, 680])).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 2 },
    ]);
  });

  it("starts a new group once earlier events have ended", () => {
    expect(assignLanes([600, 630, 700])).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 1 },
    ]);
  });

  it("preserves input order in the result", () => {
    expect(assignLanes([630, 600])).toEqual([
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 2 },
    ]);
  });
});
