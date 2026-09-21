import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHmac } from 'node:crypto'
import pg from 'pg'
import { createPool, migrate, mutate, readState, cleanup } from '../server/db.js'
import { createApp } from '../server/app.js'
import { balance, AppError } from '../src/store.js'

const url = process.env.TEST_DATABASE_URL
// A dedicated random schema avoids touching application data, even on a shared local DB.
test('PostgreSQL: транзакции, API, изоляция аккаунтов и очистка', { skip: !url }, async t => {
  const admin = createPool(url), schema = `test_${randomUUID().replaceAll('-', '')}`
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 10 })
  let server
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve))
    await pool.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  })
  await migrate(pool)
  await migrate(pool)
  await pool.query("INSERT INTO teachers(id,name,timezone) VALUES ('a','Первый','Europe/Kyiv'),('b','Второй','UTC')")
  let studentId, lessonId
  const lesson = { date: '2026-01-05', time: '12:00', feedback: '' }
  await t.test('Конкурентное создание учеников не обходит Free', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => mutate(pool, 'a', 'student.save', { name: `Ученик ${i}`, notes: '' })))
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 3)
    assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'PLAN_LIMIT').length, 2)
    studentId = (await readState(pool, 'a')).students[0].id
  })
  await t.test('Конкурентные уроки и платежи; сохранение баланса в PostgreSQL', async () => {
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => mutate(pool, 'a', 'lesson.save', { ...lesson, student_id: studentId })))
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 10)
    assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'PLAN_LIMIT').length, 2)
    let state = await mutate(pool, 'a', 'payment.save', { student_id: studentId, date: lesson.date, amount: 100.50, currency: 'EUR', lessons_count: 12 })
    assert.equal(balance(state, studentId), 2)
    state = await readState(pool, 'a'); assert.equal(state.payments[0].date, lesson.date); assert.equal(state.payments[0].amount, 100.50)
    lessonId = state.lessons[0].id
    const paymentId = state.payments[0].id
    await mutate(pool, 'a', 'payment.save', { id: paymentId, student_id: studentId, date: lesson.date, amount: 40, currency: 'USD', lessons_count: 4 })
    assert.equal(balance(await readState(pool, 'a'), studentId), -6)
    await mutate(pool, 'a', 'payment.delete', { id: paymentId })
    assert.equal(balance(await readState(pool, 'a'), studentId), -10)
  })
  await t.test('Чужие ID и ошибки не меняют ни один аккаунт', async () => {
    const before = await readState(pool, 'a')
    await assert.rejects(mutate(pool, 'b', 'student.save', { id: studentId, name: 'Подмена', notes: '' }), e => e.status === 404)
    await assert.rejects(mutate(pool, 'b', 'lesson.delete', { id: lessonId }), e => e.status === 404)
    await assert.rejects(mutate(pool, 'b', 'payment.save', { student_id: studentId, date: lesson.date, amount: 10, currency: 'USD', lessons_count: 1 }), e => e.status === 404)
    await assert.rejects(mutate(pool, 'a', 'lesson.save', { ...lesson, student_id: studentId, date: 'wrong' }))
    assert.deepEqual(await readState(pool, 'a'), before)
    assert.equal((await readState(pool, 'b')).students.length, 0)
  })
  await t.test('Удаление урока освобождает слот, перенос в заполненную неделю откатывается', async () => {
    await mutate(pool, 'a', 'lesson.delete', { id: lessonId })
    await mutate(pool, 'a', 'lesson.save', { ...lesson, student_id: studentId })
    const state = await mutate(pool, 'a', 'lesson.save', { ...lesson, student_id: studentId, date: '2026-01-12' })
    const moving = state.lessons.at(-1).id
    await assert.rejects(mutate(pool, 'a', 'lesson.save', { ...lesson, student_id: studentId, id: moving }), e => e.code === 'PLAN_LIMIT')
    assert.deepEqual(await readState(pool, 'a'), state)
  })
  await t.test('Корзина: восстановление и автоматическое каскадное удаление', async () => {
    await mutate(pool, 'a', 'student.trash', { id: studentId })
    await assert.rejects(mutate(pool, 'a', 'student.save', { name: 'Лишний', notes: '' }), e => e.code === 'PLAN_LIMIT')
    await mutate(pool, 'a', 'student.restore', { id: studentId })
    assert.equal((await readState(pool, 'a')).lessons.length, 11)
    await mutate(pool, 'a', 'student.trash', { id: studentId })
    await pool.query("UPDATE students SET deleted_at=now()-interval '721 hours' WHERE id=$1", [studentId])
    await cleanup(pool)
    const state = await readState(pool, 'a')
    assert.equal(state.students.length, 2); assert.equal(state.lessons.length, 0)
    await mutate(pool, 'a', 'student.save', { name: 'Новый', notes: '' })
  })
  await t.test('HTTP: Telegram-сессия, CSRF, отсутствие доступа без входа', async () => {
    const fixtureKey = 'integration-fixture-only'
    let rateFails = false
    server = createApp(pool, { botToken: fixtureKey, devAuth: false, origin: 'http://localhost:5173', getRate: async () => {
      if (rateFails) throw new AppError('Курс временно недоступен', 503, 'RATE_UNAVAILABLE')
      return { value: 1.1, date: '2026-09-21' }
    } })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}/api`
    const post = (path, payload, cookie, origin = 'http://localhost:5173') => fetch(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(payload) })
    assert.equal((await fetch(`${base}/state`)).status, 401)
    assert.equal((await post('auth', { initData: '', timezone: 'UTC' })).status, 401)
    const data = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 987654, first_name: 'Тест API' }) })
    const secret = createHmac('sha256', 'WebAppData').update(fixtureKey).digest()
    const check = [...data].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')
    data.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
    const login = await post('auth', { initData: data.toString(), timezone: 'UTC' })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie').split(';')[0]
    assert.match(login.headers.get('set-cookie'), /HttpOnly/)
    const create = { action: 'student.save', payload: { name: 'API ученик', notes: '' } }
    assert.equal((await post('actions', create, cookie, 'https://invalid.example')).status, 403)
    let response = await post('actions', create, cookie)
    assert.equal(response.status, 200)
    const state = await response.json(); assert.equal(state.students.length, 1)
    response = await post('actions', { action: 'student.delete', payload: { id: studentId } }, cookie)
    assert.equal(response.status, 404)
    response = await fetch(`${base}/statistics?period=month&date=2026-01-01&currency=USD`, { headers: { Cookie: cookie } })
    assert.equal(response.status, 200); assert.equal((await response.json()).count, 0)
    const apiStudent = state.students[0].id
    response = await post('actions', { action: 'payment.save', payload: { student_id: apiStudent, date: '2026-01-05', amount: 10, currency: 'EUR', lessons_count: 3 } }, cookie)
    assert.equal(response.status, 200)
    response = await fetch(`${base}/statistics?period=month&date=2026-01-01&currency=USD`, { headers: { Cookie: cookie } })
    let stats = await response.json(); assert.equal(stats.paid, 11); assert.equal(stats.converted, true)
    rateFails = true
    response = await fetch(`${base}/statistics?period=month&date=2026-01-01&currency=USD`, { headers: { Cookie: cookie } })
    stats = await response.json(); assert.equal(stats.paid, null); assert.equal(stats.count, 0); assert.ok(stats.rateError)
    await post('actions', { action: 'student.trash', payload: { id: apiStudent } }, cookie)
    response = await post('actions', { action: 'trash.empty', payload: {} }, cookie)
    const cleared = await response.json(); assert.equal(cleared.students.length, 0); assert.equal(cleared.payments.length, 0)
    await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE teacher_id='987654'")
    assert.equal((await fetch(`${base}/state`, { headers: { Cookie: cookie } })).status, 401)
  })
})
