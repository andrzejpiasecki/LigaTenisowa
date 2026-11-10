export const MATCH_MS = 90 * 60000;
export function overlap(a: number, b: number, c: number, d: number) { return a < d && b > c; }
export function warsawParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { day: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}
export function warsawInstant(day: string, time: string) {
  const wall = Date.parse(`${day}T${time}:00Z`);
  let result = wall;
  for (let i = 0; i < 3; i++) {
    const parts = warsawParts(new Date(result));
    result += wall - Date.parse(`${parts.day}T${parts.time}:00Z`);
  }
  const parts = warsawParts(new Date(result));
  if (parts.day !== day || parts.time !== time) throw new Error("Ta godzina nie istnieje w strefie Europe/Warsaw.");
  return result;
}
export function commonSlots(a: Array<[number, number]>, b: Array<[number, number]>, now: number, horizon: number) {
  const result = new Set<number>();
  for (const [aStart, aEnd] of a) for (const [bStart, bEnd] of b) {
    const end = Math.min(aEnd, bEnd, horizon);
    for (let start = Math.ceil(Math.max(aStart, bStart, now) / 1800000) * 1800000; start + MATCH_MS <= end; start += 1800000) result.add(start);
  }
  return [...result].sort((x, y) => x - y);
}
