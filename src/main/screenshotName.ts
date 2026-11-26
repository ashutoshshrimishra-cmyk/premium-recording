const pad = (value: number, length = 2): string => String(value).padStart(length, '0')

/** File name for an annotation screenshot, e.g. Screenshot_2025-01-31_14-05-09-042.png (local time). */
export function screenshotFileName(date: Date): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return `Screenshot_${day}_${time}-${pad(date.getMilliseconds(), 3)}.png`
}
