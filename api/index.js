import { createHandler } from '../server/app.js'
import { createPool, migrate, cleanup } from '../server/db.js'

const pool = createPool()
let ready

function initialize() {
  if (!ready) {
    ready = (async () => {
      await migrate(pool)
      await cleanup(pool)
    })()
  }
  return ready
}

const handler = createHandler(pool)

export default async function vercelHandler(req, res) {
  try {
    await initialize()
    return await handler(req, res)
  } catch (error) {
    console.error('Ошибка запуска API:', error?.code ?? error?.name ?? 'UNKNOWN')
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify({ message: 'Сервер недоступен. Повторите попытку.', code: 'SERVER_ERROR' }))
    }
  }
}
