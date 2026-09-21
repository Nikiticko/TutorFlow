import { createServer } from 'node:http'
import { AppError, statistics, timezone } from '../src/store.js'
import { readState, mutate } from './db.js'
import { validateTelegram, sessionToken, hashToken } from './auth.js'
import { exchangeRate } from './rates.js'

async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('Ожидается JSON.', 415)
  let size = 0, chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 32768) throw new AppError('Запрос слишком большой.', 413)
    chunks.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString())
    if (!value || Array.isArray(value) || typeof value !== 'object') throw Error()
    return value
  } catch { throw new AppError('Некорректный JSON.') }
}
function reply(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  res.end(JSON.stringify(data))
}
export function createApp(pool, { botToken = process.env.BOT_TOKEN, origin = process.env.APP_ORIGIN || 'http://localhost:5173', devAuth = process.env.DEV_AUTH === '1' && process.env.NODE_ENV !== 'production', getRate = exchangeRate } = {}) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      if (req.method !== 'GET' && req.headers.origin !== origin) throw new AppError('Недопустимый источник запроса.', 403)
      if (url.pathname === '/api/auth' && req.method === 'POST') {
        const form = await body(req)
        const zone = timezone(form.timezone)
        const localHost = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host ?? '')
        const localOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
        const user = !form.initData && devAuth && localHost && localOrigin
          ? { id: 'local-dev', name: 'Локальный репетитор' }
          : validateTelegram(form.initData, botToken)
        await pool.query('INSERT INTO teachers (id,name,timezone) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name', [user.id, user.name, zone])
        const token = sessionToken()
        await pool.query("INSERT INTO sessions (token_hash,teacher_id,expires_at) VALUES ($1,$2,now()+interval '7 days')", [hashToken(token), user.id])
        res.setHeader('Set-Cookie', `tutorflow_session=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=604800${origin.startsWith('https:') ? '; Secure' : ''}`)
        return reply(res, 200, { ok: true })
      }
      const token = /(?:^|;\s*)tutorflow_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1]
      const session = token && (await pool.query('SELECT teacher_id FROM sessions WHERE token_hash=$1 AND expires_at>now()', [hashToken(token)])).rows[0]
      if (!session) throw new AppError('Войдите через Telegram.', 401)
      if (url.pathname === '/api/state' && req.method === 'GET') return reply(res, 200, await readState(pool, session.teacher_id))
      if (url.pathname === '/api/actions' && req.method === 'POST') {
        const { action, payload } = await body(req)
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new AppError('Некорректные параметры действия.')
        return reply(res, 200, await mutate(pool, session.teacher_id, action, payload))
      }
      if (url.pathname === '/api/statistics' && req.method === 'GET') {
        const state = await readState(pool, session.teacher_id)
        const args = [state, url.searchParams.get('period'), url.searchParams.get('date'), url.searchParams.get('currency')]
        let result = statistics(...args)
        if (result.converted) {
          try { result = statistics(...args, await getRate(result.currency)) }
          catch (error) { if (error.code !== 'RATE_UNAVAILABLE') throw error; result.rateError = error.message }
        }
        return reply(res, 200, result)
      }
      throw new AppError('Страница не найдена.', 404)
    } catch (error) {
      const known = error instanceof AppError
      if (!known) console.error('Ошибка API:', error.code ?? error.name)
      reply(res, known ? error.status : 500, { message: known ? error.message : 'Сервер недоступен. Повторите попытку.', code: known ? error.code : 'SERVER_ERROR' })
    }
  })
}
