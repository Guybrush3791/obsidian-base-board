// Pure date helpers for the calendar view. Kept free of any `obsidian` import
// so they can be unit-tested directly.

/** A card's date resolved to local calendar fields. */
export interface CardDate {
  /** Local calendar day, formatted as YYYY-MM-DD. */
  dateKey: string;
  /** Minutes since local midnight, or null for a date-only (all-day) value. */
  minutes: number | null;
}

// YYYY-MM-DD, optionally followed by a time (THH:mm[:ss[.sss]]) and a zone.
const DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Format a local calendar day as YYYY-MM-DD (month is 1-based). */
export function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The local YYYY-MM-DD key of a Date. */
export function dateKeyFromDate(date: Date): string {
  return toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Parse a frontmatter date value such as `2026-10-13`, `2026-10-13T22:00:00`
 * or `2026-10-13T20:00:00Z`.
 *
 * Values without a zone are taken as local wall-clock time, so
 * `2026-10-13T22:00:00` lands on the 13th at 22:00 regardless of the system
 * timezone. Values with a zone are converted to local time. Anything that is
 * not a real calendar date (e.g. `2026-02-30`) returns null.
 */
export function parseCardDate(raw: unknown): CardDate | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return {
      dateKey: dateKeyFromDate(raw),
      minutes: raw.getHours() * 60 + raw.getMinutes(),
    };
  }
  if (typeof raw !== "string") return null;

  const match = DATE_RE.exec(raw.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  if (match[4] === undefined) {
    return { dateKey: toDateKey(year, month, day), minutes: null };
  }

  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] !== undefined ? Number(match[6]) : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;

  if (match[7] !== undefined) {
    const date = new Date(raw.trim());
    if (Number.isNaN(date.getTime())) return null;
    return {
      dateKey: dateKeyFromDate(date),
      minutes: date.getHours() * 60 + date.getMinutes(),
    };
  }

  return { dateKey: toDateKey(year, month, day), minutes: hour * 60 + minute };
}

/** Format minutes since midnight as HH:mm. */
export function formatMinutes(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Move a (year, 0-based month) pair by `delta` months. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/**
 * Build the weeks shown for a month: full weeks starting on `firstDayOfWeek`
 * (0 = Sunday … 6 = Saturday) covering every day of the month, padded with
 * days from the adjacent months. Returns 4–6 weeks of 7 YYYY-MM-DD keys.
 */
export function buildMonthGrid(
  year: number,
  month: number,
  firstDayOfWeek: number,
): string[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() - firstDayOfWeek + 7) % 7;
  const total = new Date(year, month + 1, 0).getDate();
  const weekCount = Math.ceil((lead + total) / 7);

  const weeks: string[][] = [];
  for (let w = 0; w < weekCount; w++) {
    const week: string[] = [];
    for (let d = 0; d < 7; d++) {
      // The Date constructor normalises out-of-range days into the
      // neighbouring months, and stays on local midnight across DST changes.
      week.push(dateKeyFromDate(new Date(year, month, 1 - lead + w * 7 + d)));
    }
    weeks.push(week);
  }
  return weeks;
}

/** Placement of a timed event within its group of overlapping events. */
export interface Lane {
  lane: number;
  lanes: number;
}

/**
 * Assign side-by-side lanes to timed events so overlapping ones don't cover
 * each other. Each event occupies `[start, start + duration)` minutes. Events
 * that transitively overlap share a lane count, so they split the width
 * evenly. The result is index-aligned with `starts`.
 */
export function assignLanes(starts: number[], duration = 60): Lane[] {
  const order = starts.map((_, i) => i).sort((a, b) => starts[a] - starts[b]);
  const result: Lane[] = new Array<Lane>(starts.length);

  let cluster: number[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const i of cluster) result[i].lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };

  for (const i of order) {
    const start = starts[i];
    if (start >= clusterEnd) flush();

    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = start + duration;
    clusterEnd = Math.max(clusterEnd, start + duration);
    cluster.push(i);
    result[i] = { lane, lanes: 0 };
  }
  flush();
  return result;
}
