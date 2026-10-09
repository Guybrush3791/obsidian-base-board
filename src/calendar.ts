import { moment as obsidianMoment, setIcon, TFile } from "obsidian";
import type MomentLib from "moment";
import type { KanbanView } from "./kanban-view";
import { relativeLuminance } from "./color-utils";
import {
  assignLanes,
  buildMonthGrid,
  CardDate,
  dateKeyFromDate,
  formatMinutes,
  parseCardDate,
  shiftMonth,
} from "./calendar-utils";

// obsidian.d.ts types `moment` as a namespace import, which TypeScript does
// not treat as callable; at runtime it is the moment function itself.
const moment = obsidianMoment as unknown as typeof MomentLib;

/** A card placed on the calendar through its date property. */
interface CalendarEvent {
  file: TFile;
  title: string;
  columnName: string;
  color: string | null;
  date: CardDate;
}

/** Pixel height of one hour in the day sidebar timeline. */
const HOUR_HEIGHT = 48;
/** Event chips shown in a month cell before collapsing into "+N more". */
const MAX_CHIPS_PER_DAY = 3;
/** Hour the timeline scrolls to when the open day has no timed cards. */
const DEFAULT_SCROLL_HOUR = 7;

/** Run `fn` on click and on Enter/Space, for div-based buttons. */
function onActivate(el: HTMLElement, fn: (e: Event) => void): void {
  el.addEventListener("click", fn);
  el.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn(e);
    }
  });
}

/**
 * Month calendar rendered below the board. Every card whose date property
 * holds a valid date (e.g. `2026-10-13` or `2026-10-13T22:00:00`) appears on
 * its day. Clicking a day splits the calendar and opens a sidebar listing that
 * day's cards by time; closing the sidebar restores the full-width month.
 *
 * Month and selected day are view-local UI state, so they survive board
 * re-renders but are not written to the .base file.
 */
export class CalendarManager {
  private view: KanbanView;
  private rootEl: HTMLElement | null = null;
  private year: number;
  private month: number;
  private selectedDate: string | null = null;
  private eventsByDate = new Map<string, CalendarEvent[]>();
  private totalCards = 0;
  private gridScrollTop = 0;
  private timelineScroll: { date: string; top: number } | null = null;

  constructor(view: KanbanView) {
    this.view = view;
    const today = new Date();
    this.year = today.getFullYear();
    this.month = today.getMonth();
  }

  /** Remember scroll offsets before the calendar DOM is torn down. */
  public captureScroll(): void {
    if (!this.rootEl) return;
    const gridEl = this.rootEl.querySelector<HTMLElement>(
      ".base-board-calendar-grid",
    );
    if (gridEl) this.gridScrollTop = gridEl.scrollTop;
    const timelineEl = this.rootEl.querySelector<HTMLElement>(
      ".base-board-calendar-timeline",
    );
    if (timelineEl && this.selectedDate) {
      this.timelineScroll = {
        date: this.selectedDate,
        top: timelineEl.scrollTop,
      };
    }
  }

  /** Build the calendar at the end of the board container. */
  public render(containerEl: HTMLElement): void {
    this.rootEl = null;
    if (!this.view.isCalendarEnabled()) return;

    this.collectEvents();
    this.rootEl = containerEl.createDiv({ cls: "base-board-calendar" });
    this.rootEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape" && this.selectedDate) {
        e.preventDefault();
        this.closeDay();
      }
    });
    this.draw();
  }

  /**
   * Redraw only the calendar, leaving the board untouched. `focusSelector`
   * restores keyboard focus to the matching element of the new DOM.
   */
  public refresh(focusSelector?: string): void {
    if (!this.rootEl) return;
    this.captureScroll();
    this.rootEl.empty();
    this.draw();
    if (focusSelector) {
      this.rootEl.querySelector<HTMLElement>(focusSelector)?.focus();
    }
  }

  // ---------------------------------------------------------------------------
  //  Data
  // ---------------------------------------------------------------------------

  private collectEvents(): void {
    this.eventsByDate.clear();
    this.totalCards = 0;
    const prop = this.view.getCalendarDateProperty();

    for (const columnName of this.view.getColumns()) {
      const group = this.view.getGroupForColumn(columnName);
      for (const entry of this.view.getEntriesForColumn(columnName, group)) {
        const file = entry.file;
        if (!(file instanceof TFile) || !this.view.tags.matchesFilters(file)) {
          continue;
        }
        this.totalCards++;

        const frontmatter =
          this.view.app.metadataCache.getFileCache(file)?.frontmatter;
        const date = parseCardDate(frontmatter?.[prop]);
        if (!date) continue;

        const list = this.eventsByDate.get(date.dateKey) ?? [];
        list.push({
          file,
          title: this.view.cardManager.getCardTitle(entry),
          columnName,
          color: this.view.getColumnColor(columnName),
          date,
        });
        this.eventsByDate.set(date.dateKey, list);
      }
    }

    // All-day cards first, then by time, then by title.
    for (const list of this.eventsByDate.values()) {
      list.sort(
        (a, b) =>
          (a.date.minutes ?? -1) - (b.date.minutes ?? -1) ||
          a.title.localeCompare(b.title),
      );
    }
  }

  // ---------------------------------------------------------------------------
  //  State changes
  // ---------------------------------------------------------------------------

  private toggleDay(dateKey: string): void {
    this.selectedDate = this.selectedDate === dateKey ? null : dateKey;
    this.refresh(`[data-date="${dateKey}"]`);
  }

  private closeDay(): void {
    const closed = this.selectedDate;
    this.selectedDate = null;
    this.refresh(closed ? `[data-date="${closed}"]` : undefined);
  }

  private goToMonth(delta: number | null, action: string): void {
    if (delta === null) {
      const today = new Date();
      this.year = today.getFullYear();
      this.month = today.getMonth();
    } else {
      ({ year: this.year, month: this.month } = shiftMonth(
        this.year,
        this.month,
        delta,
      ));
    }
    this.gridScrollTop = 0;
    this.refresh(`[data-action="${action}"]`);
  }

  // ---------------------------------------------------------------------------
  //  Rendering
  // ---------------------------------------------------------------------------

  private draw(): void {
    const rootEl = this.rootEl;
    if (!rootEl) return;
    const collapsed = this.view.isCalendarCollapsed();
    rootEl.toggleClass("base-board-calendar--collapsed", collapsed);

    this.drawHeader(rootEl, collapsed);
    if (collapsed) return;

    const bodyEl = rootEl.createDiv({ cls: "base-board-calendar-body" });
    this.drawGrid(bodyEl);
    if (this.selectedDate) {
      bodyEl.addClass("base-board-calendar-body--split");
      this.drawSidebar(bodyEl, this.selectedDate);
    }
  }

  private drawHeader(rootEl: HTMLElement, collapsed: boolean): void {
    const headerEl = rootEl.createDiv({ cls: "base-board-calendar-header" });

    const collapseBtn = headerEl.createDiv({
      cls: "base-board-calendar-icon-btn",
      attr: {
        role: "button",
        tabindex: "0",
        "data-action": "collapse",
        "aria-label": collapsed ? "Expand calendar" : "Collapse calendar",
      },
    });
    setIcon(collapseBtn, collapsed ? "chevron-right" : "chevron-down");
    onActivate(collapseBtn, () => this.view.setCalendarCollapsed(!collapsed));

    const titleEl = headerEl.createDiv({ cls: "base-board-calendar-title" });
    setIcon(
      titleEl.createSpan({ cls: "base-board-calendar-title-icon" }),
      "calendar",
    );
    titleEl.createSpan({ text: "Calendar" });

    let dated = 0;
    const legend = new Map<string, string>();
    for (const list of this.eventsByDate.values()) {
      dated += list.length;
      for (const ev of list) {
        if (ev.color) legend.set(ev.columnName, ev.color);
      }
    }
    headerEl.createSpan({
      cls: "base-board-calendar-summary",
      text: `${dated} of ${this.totalCards} cards have a valid date`,
    });

    if (!collapsed && legend.size > 0) {
      const legendEl = headerEl.createDiv({
        cls: "base-board-calendar-legend",
      });
      // Follow board column order rather than discovery order.
      for (const columnName of this.view.getColumns()) {
        const color = legend.get(columnName);
        if (!color) continue;
        const itemEl = legendEl.createSpan({
          cls: "base-board-calendar-legend-item",
          text: columnName,
        });
        itemEl.style.setProperty("--event-color", color);
      }
    }

    headerEl.createDiv({ cls: "base-board-header-spacer" });
    if (collapsed) return;

    const navEl = headerEl.createDiv({ cls: "base-board-calendar-nav" });
    const todayBtn = navEl.createDiv({
      cls: "base-board-calendar-today-btn",
      text: "Today",
      attr: { role: "button", tabindex: "0", "data-action": "today" },
    });
    onActivate(todayBtn, () => this.goToMonth(null, "today"));

    const prevBtn = navEl.createDiv({
      cls: "base-board-calendar-icon-btn",
      attr: {
        role: "button",
        tabindex: "0",
        "data-action": "prev",
        "aria-label": "Previous month",
      },
    });
    setIcon(prevBtn, "chevron-left");
    onActivate(prevBtn, () => this.goToMonth(-1, "prev"));

    navEl.createSpan({
      cls: "base-board-calendar-month-label",
      text: moment([this.year, this.month, 1]).format("MMMM YYYY"),
    });

    const nextBtn = navEl.createDiv({
      cls: "base-board-calendar-icon-btn",
      attr: {
        role: "button",
        tabindex: "0",
        "data-action": "next",
        "aria-label": "Next month",
      },
    });
    setIcon(nextBtn, "chevron-right");
    onActivate(nextBtn, () => this.goToMonth(1, "next"));
  }

  private drawGrid(bodyEl: HTMLElement): void {
    const gridEl = bodyEl.createDiv({ cls: "base-board-calendar-grid" });
    // Week start and weekday names follow Obsidian's locale.
    const firstDay = moment.localeData().firstDayOfWeek();
    const weekdayNames = moment.weekdaysShort();

    const weekdaysEl = gridEl.createDiv({
      cls: "base-board-calendar-weekdays",
    });
    for (let i = 0; i < 7; i++) {
      weekdaysEl.createDiv({
        cls: "base-board-calendar-weekday",
        text: weekdayNames[(firstDay + i) % 7],
      });
    }

    const todayKey = dateKeyFromDate(new Date());
    for (const week of buildMonthGrid(this.year, this.month, firstDay)) {
      const weekEl = gridEl.createDiv({ cls: "base-board-calendar-week" });
      for (const dateKey of week) {
        this.drawDay(weekEl, dateKey, todayKey);
      }
    }
    gridEl.scrollTop = this.gridScrollTop;
  }

  private drawDay(
    weekEl: HTMLElement,
    dateKey: string,
    todayKey: string,
  ): void {
    const day = moment(dateKey, "YYYY-MM-DD");
    const events = this.eventsByDate.get(dateKey) ?? [];
    const dayEl = weekEl.createDiv({
      cls: "base-board-calendar-day",
      attr: {
        role: "button",
        tabindex: "0",
        "data-date": dateKey,
        "aria-pressed": String(dateKey === this.selectedDate),
        "aria-label": `${day.format("dddd LL")}, ${events.length} card${events.length === 1 ? "" : "s"}`,
      },
    });
    dayEl.toggleClass(
      "base-board-calendar-day--outside",
      day.month() !== this.month,
    );
    dayEl.toggleClass("base-board-calendar-day--today", dateKey === todayKey);
    dayEl.toggleClass(
      "base-board-calendar-day--selected",
      dateKey === this.selectedDate,
    );
    dayEl.toggleClass(
      "base-board-calendar-day--weekend",
      day.day() === 0 || day.day() === 6,
    );

    dayEl.createDiv({
      cls: "base-board-calendar-day-number",
      text: day.date() === 1 ? day.format("D MMM") : String(day.date()),
    });

    for (const ev of events.slice(0, MAX_CHIPS_PER_DAY)) {
      const chipEl = dayEl.createDiv({ cls: "base-board-calendar-chip" });
      this.applyEventColor(chipEl, ev);
      if (ev.date.minutes === null) {
        chipEl.addClass("base-board-calendar-chip--all-day");
      } else {
        chipEl.createSpan({
          cls: "base-board-calendar-chip-time",
          text: formatMinutes(ev.date.minutes),
        });
      }
      chipEl.createSpan({
        cls: "base-board-calendar-chip-title",
        text: ev.title,
      });
      this.bindHoverPreview(chipEl, ev.file);
    }
    if (events.length > MAX_CHIPS_PER_DAY) {
      dayEl.createDiv({
        cls: "base-board-calendar-more",
        text: `+${events.length - MAX_CHIPS_PER_DAY} more`,
      });
    }

    // Chips bubble up here too: clicking anywhere in a day opens its sidebar.
    onActivate(dayEl, () => this.toggleDay(dateKey));
  }

  private drawSidebar(bodyEl: HTMLElement, dateKey: string): void {
    const day = moment(dateKey, "YYYY-MM-DD");
    const events = this.eventsByDate.get(dateKey) ?? [];

    // The sidebar is absolutely filled so its tall timeline never stretches
    // the calendar: the month grid alone decides the body height.
    const sidebarEl = bodyEl.createDiv({
      cls: "base-board-calendar-sidebar",
      attr: { role: "region", "aria-label": day.format("dddd LL") },
    });
    const innerEl = sidebarEl.createDiv({
      cls: "base-board-calendar-sidebar-inner",
    });

    const headerEl = innerEl.createDiv({
      cls: "base-board-calendar-sidebar-header",
    });
    const titlesEl = headerEl.createDiv();
    titlesEl.createDiv({
      cls: "base-board-calendar-sidebar-weekday",
      text: day.format("dddd"),
    });
    titlesEl.createDiv({
      cls: "base-board-calendar-sidebar-date",
      text: day.format("LL"),
    });
    titlesEl.createDiv({
      cls: "base-board-calendar-sidebar-count",
      text:
        events.length === 0
          ? "No cards scheduled"
          : `${events.length} card${events.length === 1 ? "" : "s"} scheduled`,
    });
    headerEl.createDiv({ cls: "base-board-header-spacer" });
    const closeBtn = headerEl.createDiv({
      cls: "base-board-calendar-icon-btn",
      attr: { role: "button", tabindex: "0", "aria-label": "Close day" },
    });
    setIcon(closeBtn, "x");
    onActivate(closeBtn, () => this.closeDay());

    const allDay = events.filter((ev) => ev.date.minutes === null);
    if (allDay.length > 0) {
      const allDayEl = innerEl.createDiv({
        cls: "base-board-calendar-all-day",
      });
      allDayEl.createDiv({
        cls: "base-board-calendar-section-label",
        text: "All day",
      });
      for (const ev of allDay) this.drawAgendaEvent(allDayEl, ev);
    }

    const timelineEl = innerEl.createDiv({
      cls: "base-board-calendar-timeline",
    });
    const trackEl = timelineEl.createDiv({
      cls: "base-board-calendar-timeline-track",
    });
    trackEl.style.height = `${24 * HOUR_HEIGHT}px`;
    for (let hour = 0; hour < 24; hour++) {
      const hourEl = trackEl.createDiv({ cls: "base-board-calendar-hour" });
      hourEl.style.top = `${hour * HOUR_HEIGHT}px`;
      hourEl.createSpan({
        cls: "base-board-calendar-hour-label",
        text: formatMinutes(hour * 60),
      });
    }

    const eventsEl = trackEl.createDiv({
      cls: "base-board-calendar-timeline-events",
    });
    const timed = events.filter((ev) => ev.date.minutes !== null);
    const starts = timed.map((ev) => ev.date.minutes ?? 0);
    const lanes = assignLanes(starts);
    timed.forEach((ev, i) => {
      const el = this.drawAgendaEvent(eventsEl, ev);
      el.addClass("base-board-calendar-timed-event");
      el.style.top = `${(starts[i] / 60) * HOUR_HEIGHT}px`;
      el.style.height = `${HOUR_HEIGHT - 2}px`;
      el.style.left = `${(lanes[i].lane / lanes[i].lanes) * 100}%`;
      el.style.width = `${100 / lanes[i].lanes}%`;
    });

    if (dateKey === dateKeyFromDate(new Date())) {
      const now = new Date();
      const nowEl = trackEl.createDiv({ cls: "base-board-calendar-now" });
      nowEl.style.top = `${((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT}px`;
    }

    const restored =
      this.timelineScroll?.date === dateKey ? this.timelineScroll.top : null;
    const firstMinutes = starts.length > 0 ? Math.min(...starts) : null;
    timelineEl.scrollTop =
      restored ??
      Math.max(
        0,
        ((firstMinutes ?? DEFAULT_SCROLL_HOUR * 60) / 60 - 1) * HOUR_HEIGHT,
      );
  }

  /** A card in the day sidebar: meta line (time · column, tags) + title. */
  private drawAgendaEvent(parent: HTMLElement, ev: CalendarEvent): HTMLElement {
    const el = parent.createDiv({
      cls: "base-board-calendar-agenda-event",
      attr: { role: "button", tabindex: "0" },
    });
    this.applyEventColor(el, ev);

    const metaEl = el.createDiv({ cls: "base-board-calendar-agenda-meta" });
    metaEl.createSpan({
      cls: "base-board-calendar-agenda-when",
      text:
        ev.date.minutes === null
          ? ev.columnName
          : `${formatMinutes(ev.date.minutes)} · ${ev.columnName}`,
    });
    const tagsEl = metaEl.createDiv({ cls: "base-board-calendar-agenda-tags" });
    for (const tag of this.view.tags.extractTagsFromFile(ev.file)) {
      const tagEl = tagsEl.createSpan({
        cls: "base-board-card-tag",
        text: tag,
      });
      const color = this.view.tags.getColorForTag(tag);
      if (color) {
        tagEl.style.setProperty("--tag-color", color);
        tagEl.addClass(
          relativeLuminance(color) === "dark"
            ? "base-board-card-tag-light"
            : "base-board-card-tag-dark",
        );
      }
    }

    el.createDiv({ cls: "base-board-calendar-agenda-title", text: ev.title });

    el.addEventListener("click", (e: MouseEvent) => {
      this.view.cardManager.openCardFile(ev.file, e);
    });
    el.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.view.cardManager.openCardFile(ev.file);
      }
    });
    this.bindHoverPreview(el, ev.file);
    return el;
  }

  private applyEventColor(el: HTMLElement, ev: CalendarEvent): void {
    if (ev.color) el.style.setProperty("--event-color", ev.color);
  }

  /** Native page preview on hover, same as board cards. */
  private bindHoverPreview(el: HTMLElement, file: TFile): void {
    el.addEventListener("mouseenter", (evt: MouseEvent) => {
      this.view.app.workspace.trigger("hover-link", {
        event: evt,
        source: "base-board",
        hoverParent: this.view,
        targetEl: el,
        linktext: file.path,
      });
    });
  }
}
