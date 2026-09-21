import { createPool, migrate, cleanup } from './db.js'
import { createApp } from './app.js'
const pool = createPool()
await migrate(pool)
await cleanup(pool)
const server = createApp(pool)
const port = Number(process.env.PORT || 3001)
server.listen(port, '127.0.0.1', () => console.log(`TutorFlow API: http://127.0.0.1:${port}`))
let cleaning = false
const timer = setInterval(async () => {
  if (cleaning) return
  cleaning = true
  try { await cleanup(pool) } catch { console.error('Не удалось очистить просроченную корзину.') } finally { cleaning = false }
}, 60000)
timer.unref()
async function stop() { clearInterval(timer); server.close(async () => { await pool.end(); process.exit(0) }) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
