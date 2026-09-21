import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAction, balance, today, lessonInstant, periodBounds, statistics, moneyLabel, paginate, purgeExpired } from '../src/store.js'
const now = new Date('2026-09-21T12:00:00Z')
const fresh = (plan = 'free', timezone = 'Europe/Kyiv') => ({ teacher: { id: 'test', plan, timezone }, students: [], lessons: [], payments: [] })
const act = (s, name, form = {}) => applyAction(s, name, form, now)
function addStudent(s, name = 'Ученик') { act(s, 'student.save', { name, notes: '' }); return s.students.at(-1).id }
const lesson = (student_id, date = '2026-09-14', time = '12:00') => ({ student_id, date, time, feedback: '' })
const payment = student_id => ({ student_id, date: '2026-09-14', amount: 100, currency: 'USD', lessons_count: 10 })

test('Баланс: оплата +10, 6 уроков, удаление оплаты = -6; правки и удаление уроков', () => {
  const s = fresh(), id = addStudent(s)
  act(s, 'payment.save', payment(id))
  for (let i = 0; i < 6; i++) act(s, 'lesson.save', lesson(id))
  assert.equal(balance(s, id), 4)
  act(s, 'lesson.save', { ...lesson(id), id: s.lessons[0].id, feedback: 'Изменено' })
  assert.equal(balance(s, id), 4)
  act(s, 'payment.save', { ...payment(id), id: s.payments[0].id, lessons_count: 12, currency: 'EUR' })
  assert.equal(balance(s, id), 6)
  act(s, 'payment.delete', { id: s.payments[0].id })
  assert.equal(balance(s, id), -6)
  act(s, 'lesson.delete', { id: s.lessons[0].id })
  assert.equal(balance(s, id), -5)
})
test('Free: корзина занимает слот; восстановление и окончательное удаление', () => {
  const s = fresh(), id = addStudent(s)
  addStudent(s); addStudent(s)
  act(s, 'payment.save', payment(id)); act(s, 'lesson.save', lesson(id))
  act(s, 'student.trash', { id })
  assert.throws(() => addStudent(s), e => e.code === 'PLAN_LIMIT')
  assert.throws(() => act(s, 'lesson.save', lesson(id)))
  act(s, 'student.restore', { id }); assert.equal(balance(s, id), 9)
  act(s, 'student.trash', { id }); act(s, 'student.delete', { id })
  assert.equal(s.lessons.length, 0); assert.equal(s.payments.length, 0)
  addStudent(s); assert.equal(s.students.length, 3)
})
test('Premium: 100 учеников и 200 уроков, тариф нельзя сменить полем формы', () => {
  const s = fresh('premium')
  for (let i = 0; i < 100; i++) addStudent(s)
  assert.throws(() => addStudent(s), e => e.code === 'PLAN_LIMIT')
  for (let i = 0; i < 200; i++) act(s, 'lesson.save', lesson(s.students[0].id))
  assert.throws(() => act(s, 'lesson.save', lesson(s.students[0].id)), e => e.code === 'PLAN_LIMIT')
  act(s, 'teacher.timezone', { timezone: 'UTC', plan: 'free' }); assert.equal(s.teacher.plan, 'premium')
})
test('Лимит по дате проведения: перенос, редактирование и освобождение места', () => {
  const s = fresh(), id = addStudent(s)
  for (let i = 0; i < 10; i++) act(s, 'lesson.save', lesson(id))
  assert.throws(() => act(s, 'lesson.save', lesson(id, '2026-09-20', '23:59')), e => e.code === 'PLAN_LIMIT')
  act(s, 'lesson.save', lesson(id, '2026-09-21', '00:00'))
  const moving = s.lessons.at(-1).id
  const before = JSON.stringify(s)
  assert.throws(() => act(s, 'lesson.save', { ...lesson(id), id: moving }), e => e.code === 'PLAN_LIMIT')
  assert.equal(JSON.stringify(s), before)
  act(s, 'lesson.save', { ...lesson(id, '2026-09-20'), id: s.lessons[0].id })
  act(s, 'lesson.delete', { id: s.lessons[1].id })
  act(s, 'lesson.save', { ...lesson(id), id: moving })
  assert.equal(s.lessons.length, 10)
})
test('Нельзя менять ученика записи; невалидные формы не изменяют данные', () => {
  const s = fresh(), id = addStudent(s), other = addStudent(s)
  act(s, 'lesson.save', lesson(id)); act(s, 'payment.save', payment(id))
  const before = JSON.stringify(s)
  for (const [name, form] of [
    ['lesson.save', { ...lesson(other), id: s.lessons[0].id }],
    ['payment.save', { ...payment(other), id: s.payments[0].id }],
    ['lesson.save', lesson(id, '2026-02-30')],
    ['lesson.save', lesson(id, '2026-09-22')],
    ['lesson.save', lesson(id, '2026-09-14', '25:00')],
    ['payment.save', { ...payment(id), lessons_count: 1.5 }],
    ['payment.save', { ...payment(id), amount: -1 }],
    ['payment.save', { ...payment(id), amount: '1.234' }],
    ['payment.save', { ...payment(id), currency: 'UAH' }],
    ['teacher.timezone', { timezone: 'bad/zone' }],
    ['student.save', { id, name: ' ', notes: '' }],
  ]) assert.throws(() => act(s, name, form))
  assert.equal(JSON.stringify(s), before)
})
test('Часовые пояса, граница понедельника, DST и неоднозначное время', () => {
  assert.equal(today('Pacific/Kiritimati', new Date('2026-09-20T12:00Z')), '2026-09-21')
  assert.equal(today('America/Los_Angeles', new Date('2026-09-21T01:00Z')), '2026-09-20')
  const { start, end } = periodBounds('week', '2026-03-29', 'Europe/Berlin')
  assert.equal(start.toISODate(), '2026-03-23'); assert.equal(end.toISODate(), '2026-03-30')
  assert.equal(end.diff(start, 'hours').hours, 167)
  assert.throws(() => lessonInstant({ date: '2026-03-29', time: '02:30' }, 'Europe/Berlin', now))
  const autumn = new Date('2026-11-01T00:00Z'), form = { date: '2026-10-25', time: '02:30' }
  assert.throws(() => lessonInstant(form, 'Europe/Berlin', autumn))
  const first = lessonInstant({ ...form, offset: 120 }, 'Europe/Berlin', autumn)
  const second = lessonInstant({ ...form, offset: 60 }, 'Europe/Berlin', autumn)
  assert.equal(Date.parse(second) - Date.parse(first), 3600000)
})
test('Корзина очищается на границе 30 дней; активные записи сохраняются', () => {
  const s = fresh(), id = addStudent(s), active = addStudent(s)
  act(s, 'payment.save', payment(id)); act(s, 'lesson.save', lesson(id)); act(s, 'student.trash', { id })
  purgeExpired(s, new Date(now.getTime() + 30 * 86400000 - 1)); assert.equal(s.students.length, 2)
  purgeExpired(s, new Date(now.getTime() + 30 * 86400000)); assert.equal(s.students.length, 1)
  assert.equal(s.students[0].id, active); assert.equal(s.lessons.length, 0); assert.equal(s.payments.length, 0)
})
test('Статистика: даты в пользовательском поясе, конвертация, округление, пустые периоды', () => {
  const s = fresh(), id = addStudent(s)
  act(s, 'lesson.save', lesson(id, '2026-09-14', '00:10'))
  act(s, 'payment.save', payment(id)); act(s, 'payment.save', { ...payment(id), currency: 'EUR', amount: 10.5 })
  let stats = statistics(s, 'week', '2026-09-14', 'USD', { value: 1.1, date: '2026-09-21' })
  assert.equal(stats.count, 1); assert.equal(stats.buckets[0].lessons, 1)
  assert.equal(stats.paid, 111.55); assert.equal(stats.converted, true); assert.equal(stats.buckets.length, 7)
  assert.equal(moneyLabel(stats.paid), '≈ 112'); assert.equal(moneyLabel(100), '100')
  assert.equal(statistics(s, 'week', '2026-09-14', 'USD').paid, null)
  stats = statistics(s, 'month', '2024-02-01', 'EUR')
  assert.equal(stats.buckets.length, 29); assert.equal(stats.paid, 0)
  assert.equal(statistics(s, 'year', '2026-01-01', 'USD', { value: 1.1 }).buckets.length, 12)
})
test('Пагинация ограничивает размер страницы и корректируется после удаления', () => {
  const rows = Array.from({ length: 31 }, (_, i) => i)
  assert.equal(paginate(rows, 1, 7).rows.length, 7)
  assert.equal(paginate(rows, 2, 15).rows.length, 15)
  assert.deepEqual(paginate(rows, 9, 15), { rows: [30], page: 3, pages: 3 })
  assert.deepEqual(paginate([], 8, 7), { rows: [], page: 1, pages: 1 })
})
