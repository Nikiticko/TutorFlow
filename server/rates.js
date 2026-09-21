import { AppError } from '../src/store.js'
const cache = new Map()
export async function exchangeRate(currency) {
  const from = currency === 'USD' ? 'EUR' : 'USD'
  const key = `${from}/${currency}`
  const saved = cache.get(key)
  if (saved && Date.now() - saved.fetchedAt < 3600000) return saved
  try {
    const response = await fetch(`https://api.frankfurter.dev/v2/rate/${from.toLowerCase()}/${currency.toLowerCase()}`, { signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw Error()
    const data = await response.json()
    if (!Number.isFinite(data.rate) || data.rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw Error()
    const result = { value: data.rate, date: data.date, fetchedAt: Date.now() }
    cache.set(key, result)
    return result
  } catch { throw new AppError('Не удалось получить актуальный курс. Повторите попытку позже.', 503, 'RATE_UNAVAILABLE') }
}
