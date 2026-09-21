import { createHmac, timingSafeEqual, createHash, randomBytes } from 'node:crypto'
import { AppError } from '../src/store.js'

export function validateTelegram(initData, botToken, now = Date.now()) {
  const fail = () => { throw new AppError('Не удалось подтвердить вход. Откройте приложение заново через Telegram.', 401) }
  if (typeof initData !== 'string' || initData.length > 16384 || !botToken) fail()
  const params = new URLSearchParams(initData)
  if (new Set(params.keys()).size !== [...params.keys()].length) fail()
  const hash = params.get('hash')
  if (!hash || !/^[a-f0-9]{64}$/.test(hash)) fail()
  params.delete('hash')
  const check = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = createHmac('sha256', secret).update(check).digest()
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) fail()
  const age = now / 1000 - Number(params.get('auth_date'))
  if (!params.has('auth_date') || !Number.isFinite(age) || age < -30 || age > 3600) fail()
  let user
  try { user = JSON.parse(params.get('user')) } catch { fail() }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== 'string') fail()
  return { id: String(user.id), name: user.first_name }
}
export const sessionToken = () => randomBytes(32).toString('hex')
export const hashToken = token => createHash('sha256').update(token).digest('hex')
