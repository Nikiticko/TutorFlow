import pg from 'pg'
import { readFile } from 'node:fs/promises'
import { applyAction, AppError } from '../src/store.js'
pg.types.setTypeParser(1082, value => value)
export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('Задайте DATABASE_URL для PostgreSQL.')
  return new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 })
}
export async function migrate(pool) {
  await pool.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
}
export async function transaction(pool, work) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
const tables = {
  students: ['id', 'name', 'notes', 'created_at', 'deleted_at'],
  lessons: ['id', 'student_id', 'occurred_at', 'feedback', 'created_at'],
  payments: ['id', 'student_id', 'amount', 'currency', 'lessons_count', 'date', 'created_at'],
}
function normalize(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : key === 'amount' ? Number(value) : value]))
}
async function load(client, id) {
  const teacher = (await client.query('SELECT * FROM teachers WHERE id=$1 FOR UPDATE', [id])).rows[0]
  if (!teacher) throw new AppError('Войдите через Telegram.', 401)
  // The account lock serializes mutations, including competing limit checks and cleanup.
  await client.query("DELETE FROM students WHERE teacher_id=$1 AND deleted_at <= now() - interval '720 hours'", [id])
  const state = { teacher }
  for (const [table, columns] of Object.entries(tables)) {
    state[table] = (await client.query(`SELECT ${columns.join(',')} FROM ${table} WHERE teacher_id=$1 ORDER BY created_at, id`, [id])).rows.map(normalize)
  }
  return state
}
export function readState(pool, id) { return transaction(pool, client => load(client, id)) }
export function mutate(pool, id, action, form) {
  return transaction(pool, async client => {
    const state = await load(client, id)
    const before = structuredClone(state)
    applyAction(state, action, form)
    if (before.teacher.timezone !== state.teacher.timezone) await client.query('UPDATE teachers SET timezone=$2 WHERE id=$1', [id, state.teacher.timezone])
    // Delete children first. Only records changed by this command are written.
    for (const table of ['lessons', 'payments', 'students']) {
      const retained = new Set(state[table].map(row => row.id))
      for (const row of before[table]) if (!retained.has(row.id)) await client.query(`DELETE FROM ${table} WHERE teacher_id=$1 AND id=$2`, [id, row.id])
    }
    for (const [table, columns] of Object.entries(tables)) {
      const old = new Map(before[table].map(row => [row.id, row]))
      for (const row of state[table]) {
        if (JSON.stringify(row) === JSON.stringify(old.get(row.id))) continue
        const values = columns.map(column => row[column])
        await client.query(`INSERT INTO ${table} (teacher_id,${columns.join(',')}) VALUES ($1,${columns.map((_, i) => `$${i + 2}`).join(',')}) ON CONFLICT (id) DO UPDATE SET ${columns.filter(c => c !== 'id').map(c => `${c}=EXCLUDED.${c}`).join(',')} WHERE ${table}.teacher_id=EXCLUDED.teacher_id`, [id, ...values])
      }
    }
    return state
  })
}
export async function cleanup(pool) {
  const ids = (await pool.query("SELECT DISTINCT teacher_id FROM students WHERE deleted_at <= now() - interval '720 hours'")).rows
  for (const { teacher_id } of ids) await readState(pool, teacher_id)
  await pool.query('DELETE FROM sessions WHERE expires_at <= now()')
}
