import { DateTime, IANAZone } from 'luxon'

export const PLANS = { free: { students: 3, lessons: 10 }, premium: { students: 100, lessons: 200 } }
export const CURRENCIES = ['USD', 'EUR']
export class AppError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT') { super(message); this.status = status; this.code = code }
}
export const uid = () => globalThis.crypto.randomUUID()
export function timezone(value) {
  if (typeof value !== 'string' || !IANAZone.isValidZone(value)) throw new AppError('Укажите корректный часовой пояс IANA, например Europe/Kyiv.')
  return value
}
export const today = (zone, now = new Date()) => DateTime.fromJSDate(now, { zone }).toISODate()
export function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || !DateTime.fromISO(value).isValid) throw new AppError('Укажите корректную дату.')
  return value
}
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new AppError(`Проверьте текст: ${required ? 'поле обязательно, ' : ''}максимум ${max} символов.`)
  return value.trim()
}
export function lessonInstant(form, zone, now = new Date()) {
  dateValue(form.date)
  if (typeof form.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.time)) throw new AppError('Укажите время урока.')
  const local = `${form.date}T${form.time}`
  let dt = DateTime.fromISO(local, { zone })
  if (!dt.isValid || dt.toFormat("yyyy-MM-dd'T'HH:mm") !== local) throw new AppError('Это время отсутствует из-за перехода на летнее время.')
  const offsets = dt.getPossibleOffsets()
  if (offsets.length > 1) {
    dt = offsets.find(item => item.offset === Number(form.offset))
    if (!dt) throw new AppError('Выберите UTC-смещение: это время встречается дважды при переводе часов.')
  }
  if (dt.toMillis() > now.getTime()) throw new AppError('Можно добавить только уже проведённый урок.')
  return dt.toUTC().toISO()
}
export function periodBounds(kind, date, zone) {
  dateValue(date); timezone(zone)
  if (!['week', 'month', 'year'].includes(kind)) throw new AppError('Неизвестный период.')
  const start = DateTime.fromISO(date, { zone }).startOf(kind)
  return { start, end: start.plus({ [kind]: 1 }) }
}
export function balance(state, studentId) {
  return state.payments.filter(p => p.student_id === studentId).reduce((sum, p) => sum + p.lessons_count, 0)
    - state.lessons.filter(l => l.student_id === studentId).length
}
export function purgeExpired(state, now = new Date()) {
  const expired = new Set(state.students.filter(s => s.deleted_at && Date.parse(s.deleted_at) + 30 * 86400000 <= now.getTime()).map(s => s.id))
  removeStudents(state, expired)
}
function removeStudents(state, ids) {
  state.students = state.students.filter(s => !ids.has(s.id))
  state.lessons = state.lessons.filter(l => !ids.has(l.student_id))
  state.payments = state.payments.filter(p => !ids.has(p.student_id))
}
function getStudent(state, id, active = true) {
  const student = state.students.find(s => s.id === id)
  if (!student || (active && student.deleted_at)) throw new AppError('Ученик не найден или находится в корзине.', 404)
  return student
}
function getRecord(rows, id) {
  const record = rows.find(row => row.id === id)
  if (!record) throw new AppError('Запись не найдена.', 404)
  return record
}
export function applyAction(state, action, form, now = new Date()) {
  const created_at = now.toISOString(), limits = PLANS[state.teacher.plan]
  if (action === 'student.save') {
    const values = { name: text(form.name, 200, true), notes: text(form.notes ?? '', 10000) }
    if (form.id) Object.assign(getStudent(state, form.id), values)
    else {
      if (state.students.length >= limits.students) throw new AppError('Достигнут лимит учеников. Ученики в корзине также занимают места.', 409, 'PLAN_LIMIT')
      state.students.push({ id: uid(), ...values, created_at, deleted_at: null })
    }
  } else if (action === 'student.trash') {
    getStudent(state, form.id).deleted_at = created_at
  } else if (action === 'student.restore' || action === 'student.delete') {
    const s = getStudent(state, form.id, false)
    if (!s.deleted_at) throw new AppError('Ученик не находится в корзине.')
    if (action === 'student.restore') s.deleted_at = null
    else removeStudents(state, new Set([s.id]))
  } else if (action === 'trash.empty') {
    removeStudents(state, new Set(state.students.filter(s => s.deleted_at).map(s => s.id)))
  } else if (action === 'lesson.save') {
    const existing = form.id ? getRecord(state.lessons, form.id) : null
    if (existing && form.student_id !== existing.student_id) throw new AppError('Нельзя изменить ученика у урока.')
    const s = getStudent(state, form.student_id)
    const occurred_at = lessonInstant(form, state.teacher.timezone, now)
    const feedback = text(form.feedback ?? '', 10000)
    const { start, end } = periodBounds('week', DateTime.fromISO(occurred_at, { zone: state.teacher.timezone }).toISODate(), state.teacher.timezone)
    const inWeek = value => Date.parse(value) >= start.toMillis() && Date.parse(value) < end.toMillis()
    if ((!existing || !inWeek(existing.occurred_at)) && state.lessons.filter(l => l.id !== existing?.id && inWeek(l.occurred_at)).length >= limits.lessons) {
      throw new AppError('Достигнут лимит проведённых уроков за выбранную неделю.', 409, 'PLAN_LIMIT')
    }
    if (existing) Object.assign(existing, { occurred_at, feedback })
    else state.lessons.push({ id: uid(), student_id: s.id, occurred_at, feedback, created_at })
  } else if (action === 'payment.save') {
    const existing = form.id ? getRecord(state.payments, form.id) : null
    if (existing && form.student_id !== existing.student_id) throw new AppError('Нельзя изменить ученика у оплаты.')
    getStudent(state, form.student_id)
    const amountString = String(form.amount)
    const amount = Number(amountString), lessons_count = Number(form.lessons_count)
    if (!/^\d+(\.\d{1,2})?$/.test(amountString) || !Number.isFinite(amount) || amount <= 0 || amount > 999999999.99 || !Number.isSafeInteger(lessons_count) || lessons_count <= 0 || lessons_count > 1000000) throw new AppError('Укажите положительную сумму (до двух знаков после запятой) и целое количество уроков от 1 до 1 000 000.')
    if (!CURRENCIES.includes(form.currency)) throw new AppError('Доступны только USD и EUR.')
    const date = dateValue(form.date)
    if (date > today(state.teacher.timezone, now)) throw new AppError('Дата полученной оплаты не может быть в будущем.')
    const values = { amount, lessons_count, currency: form.currency, date }
    if (existing) Object.assign(existing, values)
    else state.payments.push({ id: uid(), student_id: form.student_id, ...values, created_at })
  } else if (action === 'lesson.delete' || action === 'payment.delete') {
    const key = action === 'lesson.delete' ? 'lessons' : 'payments'
    const record = getRecord(state[key], form.id)
    getStudent(state, record.student_id)
    state[key] = state[key].filter(row => row.id !== record.id)
  } else if (action === 'teacher.timezone') {
    state.teacher.timezone = timezone(form.timezone)
  } else throw new AppError('Неизвестное действие.', 404)
  return state
}
export function statistics(state, kind, date, currency, rate = null) {
  if (!CURRENCIES.includes(currency)) throw new AppError('Неизвестная валюта.')
  const { start, end } = periodBounds(kind, date, state.teacher.timezone)
  const lessons = state.lessons.filter(l => Date.parse(l.occurred_at) >= start.toMillis() && Date.parse(l.occurred_at) < end.toMillis())
  const payments = state.payments.filter(p => p.date >= start.toISODate() && p.date < end.toISODate())
  const converted = payments.some(p => p.currency !== currency)
  const rateAvailable = !converted || (rate && Number.isFinite(rate.value) && rate.value > 0)
  const buckets = []
  for (let cursor = start; cursor < end; cursor = cursor.plus(kind === 'year' ? { months: 1 } : { days: 1 })) {
    buckets.push({ key: cursor.toISODate().slice(0, kind === 'year' ? 7 : 10), label: cursor.setLocale('ru').toFormat(kind === 'year' ? 'LLL' : 'dd'), lessons: 0, paid: 0, converted: false })
  }
  const students = new Map()
  for (const l of lessons) {
    const key = DateTime.fromISO(l.occurred_at, { zone: state.teacher.timezone }).toISODate().slice(0, kind === 'year' ? 7 : 10)
    buckets.find(b => b.key === key).lessons++
    students.set(l.student_id, (students.get(l.student_id) ?? 0) + 1)
  }
  for (const p of payments) {
    const bucket = buckets.find(b => b.key === p.date.slice(0, kind === 'year' ? 7 : 10))
    bucket.converted ||= p.currency !== currency
    if (rateAvailable) bucket.paid += p.amount * (p.currency === currency ? 1 : rate.value)
  }
  const paid = rateAvailable ? buckets.reduce((sum, b) => sum + b.paid, 0) : null
  return { start: start.toISODate(), end: end.minus({ days: 1 }).toISODate(), count: lessons.length, paid, converted, rateDate: converted && rateAvailable ? rate.date : null, currency, buckets: buckets.map(b => ({ ...b, paid: rateAvailable ? b.paid : null })), students: [...students].map(([id, count]) => ({ id, name: state.students.find(s => s.id === id)?.name ?? 'Удалённый ученик', count })) }
}
export function moneyLabel(value) {
  if (value === null) return 'Недоступно'
  const rounded = Math.round(value)
  return `${Math.abs(value - rounded) > 1e-8 ? '≈ ' : ''}${new Intl.NumberFormat('ru-RU').format(rounded)}`
}
export function paginate(rows, page, size) {
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const current = Math.min(Math.max(1, page), pages)
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pages }
}
