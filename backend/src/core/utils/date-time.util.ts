/**
 * Utility for Indian Standard Time (IST: UTC+5:30) date and time calculations.
 * Cloud servers (Render, Railway, Supabase) run with system time set to UTC.
 */
export function getISTDateTime(date = new Date()): {
  year: number
  month: number
  day: number
  hours: number
  minutes: number
  totalMinutes: number
  dayOfWeek: number // 1 = Monday, ..., 7 = Sunday
  dateString: string // YYYY-MM-DD
} {
  // IST is UTC + 5 hours 30 minutes
  const utc = date.getTime() + date.getTimezoneOffset() * 60000
  const istDate = new Date(utc + 5.5 * 3600000)

  const hours = istDate.getHours()
  const minutes = istDate.getMinutes()
  let dayOfWeek = istDate.getDay() // 0 = Sun
  if (dayOfWeek === 0) dayOfWeek = 7

  const year = istDate.getFullYear()
  const month = istDate.getMonth() + 1
  const day = istDate.getDate()
  const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  return {
    year,
    month,
    day,
    hours,
    minutes,
    totalMinutes: hours * 60 + minutes,
    dayOfWeek,
    dateString,
  }
}
