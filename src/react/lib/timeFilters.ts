import type { Organization } from "../../types/organization";

export type TimeSelection = {
  day: number; // 0 (Sunday) - 6 (Saturday)
  hour: number; // 0 - 23
  minute: number; // 0 - 59
};

export const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const toMinutes = (time: string | null | undefined): number | null => {
  if (!time) return null;
  const [hoursPart, minutesPart] = time.split(":");
  if (hoursPart === undefined || minutesPart === undefined) return null;
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

export const isOrganizationOpenAtTime = (org: Organization, selection: TimeSelection | null): boolean => {
  if (!selection) return true;
  const periods = org.hours?.periods;
  if (!periods || periods.length === 0) return false;

  const selectedMinutes = selection.hour * 60 + selection.minute;
  const day = selection.day;

  for (const period of periods) {
    if (period.day !== day) continue;
    const openMinutes = toMinutes(period.openTime);
    const closeMinutes = toMinutes(period.closeTime);
    if (openMinutes === null || closeMinutes === null) continue;

    const isOvernight = period.isOvernight ?? closeMinutes < openMinutes;
    if (isOvernight) {
      if (selectedMinutes >= openMinutes || selectedMinutes <= closeMinutes) {
        return true;
      }
    } else if (selectedMinutes >= openMinutes && selectedMinutes <= closeMinutes) {
      return true;
    }
  }

  return false;
};

export const formatTimeSelection = (selection: TimeSelection | null): string => {
  if (!selection) return "Hours Open";
  const dayName = DAY_LABELS[selection.day] ?? `Day ${selection.day}`;
  const hour12 = selection.hour % 12 || 12;
  const minute = selection.minute.toString().padStart(2, "0");
  const suffix = selection.hour < 12 ? "AM" : "PM";
  return `${dayName} ${hour12}:${minute} ${suffix}`;
};

export const toTimeSelection = (value: TimeSelection | null | undefined): TimeSelection | null => {
  if (!value) return null;
  const day = Math.min(Math.max(value.day, 0), 6);
  const hour = Math.min(Math.max(value.hour, 0), 23);
  const minute = Math.min(Math.max(value.minute, 0), 59);
  if (day === value.day && hour === value.hour && minute === value.minute) {
    return value;
  }
  return { day, hour, minute };
};
