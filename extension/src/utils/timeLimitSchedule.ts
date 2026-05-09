import type { TimeLimitSchedule, WeekdayKey } from '../types/Rule';

export const TIME_LIMIT_WARNING_SECONDS = 10;

export const WEEKDAY_OPTIONS: Array<{ key: WeekdayKey; label: string; longLabel: string }> = [
  { key: 'mon', label: 'M', longLabel: 'Mon' },
  { key: 'tue', label: 'Tu', longLabel: 'Tue' },
  { key: 'wed', label: 'W', longLabel: 'Wed' },
  { key: 'thu', label: 'Th', longLabel: 'Thu' },
  { key: 'fri', label: 'F', longLabel: 'Fri' },
  { key: 'sat', label: 'Sa', longLabel: 'Sat' },
  { key: 'sun', label: 'Su', longLabel: 'Sun' },
];

export const DEFAULT_TIME_LIMIT_SCHEDULE: TimeLimitSchedule = {
  days: WEEKDAY_OPTIONS.map((day) => day.key),
  startTime: '09:00',
  endTime: '17:00',
};

const VALID_WEEKDAYS = new Set<WeekdayKey>(WEEKDAY_OPTIONS.map((day) => day.key));
const JS_DAY_TO_WEEKDAY: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function parseClockTime(value: string | undefined): number | null {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;

  const [hourText, minuteText] = value.split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  return (hour * 60) + minute;
}

function getWeekdayKey(date: Date): WeekdayKey {
  return JS_DAY_TO_WEEKDAY[date.getDay()];
}

function getPreviousWeekdayKey(date: Date): WeekdayKey {
  const previousDate = new Date(date);
  previousDate.setDate(previousDate.getDate() - 1);
  return getWeekdayKey(previousDate);
}

function createEndDate(baseDate: Date, endMinute: number, dayOffset: number): Date {
  const endDate = new Date(baseDate);
  endDate.setDate(endDate.getDate() + dayOffset);
  endDate.setHours(Math.floor(endMinute / 60), endMinute % 60, 0, 0);
  return endDate;
}

export function normalizeTimeLimitSchedule(schedule?: Partial<TimeLimitSchedule> | null): TimeLimitSchedule {
  const days = Array.isArray(schedule?.days)
    ? schedule.days.filter((day): day is WeekdayKey => VALID_WEEKDAYS.has(day as WeekdayKey))
    : DEFAULT_TIME_LIMIT_SCHEDULE.days;

  return {
    days: Array.from(new Set(days)),
    startTime: typeof schedule?.startTime === 'string' ? schedule.startTime : DEFAULT_TIME_LIMIT_SCHEDULE.startTime,
    endTime: typeof schedule?.endTime === 'string' ? schedule.endTime : DEFAULT_TIME_LIMIT_SCHEDULE.endTime,
  };
}

export function isTimeLimitScheduleValid(schedule?: Partial<TimeLimitSchedule> | null): boolean {
  const normalized = normalizeTimeLimitSchedule(schedule);
  const startMinute = parseClockTime(normalized.startTime);
  const endMinute = parseClockTime(normalized.endTime);

  return normalized.days.length > 0 && startMinute !== null && endMinute !== null && startMinute !== endMinute;
}

export interface TimeLimitScheduleState {
  isAllowed: boolean;
  secondsUntilEnd: number | null;
  activeEndTime: string | null;
}

export function getTimeLimitScheduleState(
  schedule?: Partial<TimeLimitSchedule> | null,
  now: Date = new Date()
): TimeLimitScheduleState {
  const normalized = normalizeTimeLimitSchedule(schedule);
  const selectedDays = new Set(normalized.days);
  const startMinute = parseClockTime(normalized.startTime);
  const endMinute = parseClockTime(normalized.endTime);

  if (selectedDays.size === 0 || startMinute === null || endMinute === null || startMinute === endMinute) {
    return { isAllowed: false, secondsUntilEnd: null, activeEndTime: null };
  }

  const currentMinute = (now.getHours() * 60) + now.getMinutes();
  const today = getWeekdayKey(now);
  const yesterday = getPreviousWeekdayKey(now);
  let activeEndDate: Date | null = null;

  if (startMinute < endMinute) {
    if (selectedDays.has(today) && currentMinute >= startMinute && currentMinute < endMinute) {
      activeEndDate = createEndDate(now, endMinute, 0);
    }
  } else {
    if (selectedDays.has(today) && currentMinute >= startMinute) {
      activeEndDate = createEndDate(now, endMinute, 1);
    } else if (selectedDays.has(yesterday) && currentMinute < endMinute) {
      activeEndDate = createEndDate(now, endMinute, 0);
    }
  }

  if (!activeEndDate) {
    return { isAllowed: false, secondsUntilEnd: null, activeEndTime: null };
  }

  return {
    isAllowed: true,
    secondsUntilEnd: Math.max(0, Math.ceil((activeEndDate.getTime() - now.getTime()) / 1000)),
    activeEndTime: normalized.endTime,
  };
}

export function formatTimeLimitSchedule(schedule?: Partial<TimeLimitSchedule> | null): string {
  const normalized = normalizeTimeLimitSchedule(schedule);
  const selected = new Set(normalized.days);
  const dayLabel = WEEKDAY_OPTIONS
    .filter((day) => selected.has(day.key))
    .map((day) => day.longLabel)
    .join(', ');

  return `${dayLabel || 'No days'} ${normalized.startTime}-${normalized.endTime}`;
}
