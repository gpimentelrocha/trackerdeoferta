export const TIME_ZONE = process.env.TRACKER_TIMEZONE || 'America/Fortaleza';
export function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function localHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(date));
}
