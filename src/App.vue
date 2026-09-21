<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { DateTime } from 'luxon'
import { useTelegram } from './composables/useTelegram'
import { api } from './api'
import { balance, paginate, PLANS, today } from './store'
import Pagination from './components/Pagination.vue'
import Statistics from './components/Statistics.vue'

const state = ref(null), loading = ref(true), busy = ref(false), error = ref(''), limitReached = ref(false)
const screen = ref('students'), studentId = ref(null), recordId = ref(null), history = ref([])
const form = reactive({}), lessonPage = ref(1), paymentPage = ref(1), allPage = ref(1)
const canGoBack = computed(() => history.value.length > 0)
const { isTelegram, nativeBack } = useTelegram({ canGoBack, onBack: back })
const zone = computed(() => state.value?.teacher.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
const student = computed(() => state.value?.students.find(s => s.id === studentId.value))
const record = computed(() => (screen.value.startsWith('payment') ? state.value?.payments : state.value?.lessons)?.find(r => r.id === recordId.value))
const activeStudents = computed(() => state.value.students.filter(s => !s.deleted_at))
const trash = computed(() => state.value.students.filter(s => s.deleted_at))
const currentBalance = computed(() => student.value ? balance(state.value, student.value.id) : 0)
const limits = computed(() => PLANS[state.value.teacher.plan])
const studentName = id => state.value.students.find(s => s.id === id)?.name ?? 'Удалённый ученик'
const isTrashed = id => Boolean(state.value.students.find(s => s.id === id)?.deleted_at)
const lessonSort = (a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
const paymentSort = (a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
const studentLessons = computed(() => paginate(state.value.lessons.filter(l => l.student_id === studentId.value).sort(lessonSort), lessonPage.value, 7))
const studentPayments = computed(() => paginate(state.value.payments.filter(p => p.student_id === studentId.value).sort(paymentSort), paymentPage.value, 7))
const allLessons = computed(() => paginate([...state.value.lessons].sort(lessonSort), allPage.value, 15))
const dateLabel = date => DateTime.fromISO(date).setLocale('ru').toFormat('d LLL yyyy')
const lessonLabel = lesson => DateTime.fromISO(lesson.occurred_at, { zone: zone.value }).setLocale('ru').toFormat('d LLL yyyy · HH:mm')
const paymentLabel = payment => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(payment.amount)} ${payment.currency}`
const deleteDate = s => DateTime.fromISO(s.deleted_at).plus({ hours: 720 }).setZone(zone.value).setLocale('ru').toFormat('d LLL yyyy · HH:mm')
const formTitle = computed(() => ({ 'student-new': 'Новый ученик', 'student-edit': 'Редактировать ученика', 'lesson-new': 'Проведённый урок', 'lesson-edit': 'Редактировать урок', 'payment-new': 'Добавить оплату', 'payment-edit': 'Редактировать оплату', settings: 'Настройки' })[screen.value])
const timeOffsets = computed(() => {
  if (!screen.value.startsWith('lesson-') || !form.date || !form.time) return []
  return DateTime.fromISO(`${form.date}T${form.time}`, { zone: zone.value }).getPossibleOffsets()
})
async function boot() {
  loading.value = true; error.value = ''
  try {
    try { state.value = await api('state') }
    catch (e) {
      if (e.status !== 401) throw e
      await api('auth', { initData: window.Telegram?.WebApp?.initData ?? '', timezone: zone.value })
      state.value = await api('state')
    }
  } catch (e) { error.value = e.message }
  finally { loading.value = false }
}
function navigate(next, push = true) {
  if (busy.value) return
  if (push) history.value.push({ screen: screen.value, studentId: studentId.value, recordId: recordId.value })
  screen.value = next; error.value = ''; limitReached.value = false
  window.scrollTo(0, 0)
}
function back() {
  if (busy.value) return
  const previous = history.value.pop()
  if (!previous) return
  navigate(previous.screen, false); studentId.value = previous.studentId; recordId.value = previous.recordId
}
function switchTab(next) {
  if (busy.value) return
  history.value = []; navigate(next, false)
}
function openStudent(id) { navigate('student'); studentId.value = id; lessonPage.value = 1; paymentPage.value = 1 }
function openRecord(type, row) { navigate(type); studentId.value = row.student_id; recordId.value = row.id }
function begin(type) {
  Object.keys(form).forEach(k => delete form[k])
  if (type === 'student-new') Object.assign(form, { name: '', notes: '' })
  if (type === 'student-edit') Object.assign(form, { id: student.value.id, name: student.value.name, notes: student.value.notes })
  if (type === 'lesson-new') Object.assign(form, { student_id: student.value.id, date: today(zone.value), time: DateTime.now().setZone(zone.value).toFormat('HH:mm'), feedback: '' })
  if (type === 'lesson-edit') {
    const local = DateTime.fromISO(record.value.occurred_at, { zone: zone.value })
    Object.assign(form, { id: record.value.id, student_id: record.value.student_id, date: local.toISODate(), time: local.toFormat('HH:mm'), offset: local.offset, feedback: record.value.feedback })
  }
  if (type === 'payment-new') Object.assign(form, { student_id: student.value.id, amount: '', currency: 'USD', lessons_count: 1, date: today(zone.value) })
  if (type === 'payment-edit') Object.assign(form, record.value)
  if (type === 'settings') form.timezone = zone.value
  navigate(type)
}
async function action(name, payload) {
  if (busy.value) return false
  busy.value = true; error.value = ''; limitReached.value = false
  try { state.value = await api('actions', { action: name, payload }); return true }
  catch (e) { error.value = e.message; limitReached.value = e.code === 'PLAN_LIMIT'; return false }
  finally { busy.value = false }
}
async function submit() {
  const actionName = screen.value === 'settings' ? 'teacher.timezone' : `${screen.value.split('-')[0]}.save`
  if (await action(actionName, { ...form })) back()
}
async function trashStudent() {
  if (await action('student.trash', { id: student.value.id })) switchTab('students')
}
async function deleteRecord(type) {
  if (!window.confirm(`Удалить ${type === 'lesson' ? 'урок' : 'оплату'}? Баланс будет пересчитан.`)) return
  if (await action(`${type}.delete`, { id: record.value.id })) back()
}
async function removeStudent(id) {
  if (window.confirm('Удалить ученика окончательно вместе со всеми уроками и оплатами? Восстановление невозможно.')) await action('student.delete', { id })
}
async function emptyTrash() {
  if (window.confirm('Полностью очистить корзину? Все ученики в ней, их уроки и оплаты будут удалены навсегда.')) await action('trash.empty', {})
}
async function refresh() {
  if (busy.value || !state.value || document.hidden || formTitle.value) return
  try {
    state.value = await api('state')
    if ((studentId.value && !student.value) || (['lesson', 'payment'].includes(screen.value) && !record.value)) switchTab('students')
  } catch (e) { error.value = e.message }
}
onMounted(() => { boot(); document.addEventListener('visibilitychange', refresh) })
onUnmounted(() => document.removeEventListener('visibilitychange', refresh))
</script>

<template>
  <div class="app-shell" :class="{ 'in-telegram': isTelegram }">
    <header class="app-toolbar">
      <span class="preview-label">TutorFlow<span v-if="state?.teacher.id === 'local-dev'"> · локальная разработка</span></span>
      <button v-if="state && !history.length" class="icon-button" aria-label="Настройки" :disabled="busy" @click="begin('settings')">⚙</button>
    </header>
    <main :aria-busy="loading || busy">
      <div v-if="error" class="notice" role="alert">{{ error }}<button v-if="limitReached" class="text-button" @click="navigate('premium')">Подробнее о Premium →</button></div>
      <p v-if="loading" class="empty" role="status">Загрузка…</p>
      <div v-else-if="!state" class="empty"><p>Откройте приложение через Telegram или запустите локальный сервер в режиме разработки.</p><button class="primary" @click="boot">Повторить вход</button></div>
      <template v-else>
        <button v-if="canGoBack && !nativeBack" class="back" :disabled="busy" @click="back">← Назад</button>
        <template v-if="screen === 'students'">
          <div class="page-heading"><h1>Ученики <span class="count">{{ activeStudents.length }}</span></h1><p class="field-help">{{ state.teacher.plan === 'premium' ? 'Premium' : 'Free' }} · занято {{ state.students.length }} из {{ limits.students }} мест, включая корзину</p></div>
          <div class="student-list"><button v-for="(s, i) in activeStudents" :key="s.id" class="student-card" @click="openStudent(s.id)"><span class="avatar" :class="`color-${i % 3}`">{{ s.name.slice(0, 1).toUpperCase() }}</span><span class="student-info"><strong>{{ s.name }}</strong><span class="note-preview">{{ s.notes || 'Без заметок' }}</span></span><span class="balance-mini" :class="{ negative: balance(state, s.id) < 0 }"><strong>{{ balance(state, s.id) }}</strong><small>уроков</small></span><span class="chevron">›</span></button></div>
          <p v-if="!activeStudents.length" class="empty">Добавьте первого ученика, чтобы начать учёт.</p>
          <button class="primary add-student" @click="begin('student-new')">＋ Добавить ученика</button>
        </template>
        <template v-else-if="screen === 'student' && student">
          <div class="profile"><div><h1>{{ student.name }}</h1><p class="preserve-text">{{ student.notes || 'Без заметок' }}</p></div><button v-if="!student.deleted_at" class="icon-button" aria-label="Редактировать ученика" @click="begin('student-edit')">✎</button></div>
          <p v-if="student.deleted_at" class="notice">Ученик в корзине. Восстановите его, чтобы изменять записи.</p>
          <div class="balance-card" :class="{ negative: currentBalance < 0 }"><span>Баланс уроков</span><strong>{{ currentBalance }}</strong><p>Оплаченные уроки минус проведённые</p></div>
          <template v-if="!student.deleted_at"><button class="primary" @click="begin('lesson-new')">＋ Проведён урок</button><button class="secondary" @click="begin('payment-new')">＋ Добавить оплату</button></template>
          <div class="section-heading"><h2>История уроков</h2></div>
          <div class="card-list"><button v-for="l in studentLessons.rows" :key="l.id" class="history-row" @click="openRecord('lesson', l)"><span><small>{{ lessonLabel(l) }}</small><strong>{{ l.feedback || 'Без обратной связи' }}</strong></span><span class="chevron">›</span></button><p v-if="!studentLessons.rows.length" class="empty">Уроков пока нет.</p></div>
          <Pagination :page="studentLessons.page" :pages="studentLessons.pages" @change="lessonPage = $event" />
          <div class="section-heading"><h2>История оплат</h2></div>
          <div class="card-list"><button v-for="p in studentPayments.rows" :key="p.id" class="history-row" @click="openRecord('payment', p)"><span><small>{{ dateLabel(p.date) }}</small><strong>{{ paymentLabel(p) }} · +{{ p.lessons_count }} уроков</strong></span><span class="chevron">›</span></button><p v-if="!studentPayments.rows.length" class="empty">Оплат пока нет.</p></div>
          <Pagination :page="studentPayments.page" :pages="studentPayments.pages" @change="paymentPage = $event" />
          <button v-if="!student.deleted_at" class="secondary danger-text" :disabled="busy" @click="trashStudent">Переместить в корзину</button>
        </template>
        <template v-else-if="formTitle">
          <h1>{{ formTitle }}</h1><p v-if="screen !== 'settings' && !screen.startsWith('student-')" class="form-subtitle">{{ student?.name }}</p>
          <form class="form" @submit.prevent="submit">
            <template v-if="screen.startsWith('student-')"><label>Название<input v-model="form.name" required maxlength="200" autocomplete="off"></label><label>Дополнительная информация<textarea v-model="form.notes" rows="5" maxlength="10000" placeholder="Заметки об ученике"></textarea></label></template>
            <template v-else-if="screen.startsWith('lesson-')"><label>Дата<input v-model="form.date" type="date" required :max="today(zone)"></label><label>Время<input v-model="form.time" type="time" required></label><label v-if="timeOffsets.length > 1">Время при переводе часов<select v-model="form.offset" required><option disabled value="">Выберите смещение</option><option v-for="dt in timeOffsets" :key="dt.offset" :value="dt.offset">UTC{{ dt.toFormat('ZZ') }}</option></select></label><p class="field-help">Часовой пояс: {{ zone }}</p><label>Обратная связь · необязательно<textarea v-model="form.feedback" rows="5" maxlength="10000"></textarea></label><p class="form-preview">{{ form.id ? 'Баланс не изменится' : `Баланс: ${currentBalance} → ${currentBalance - 1}` }}</p></template>
            <template v-else-if="screen.startsWith('payment-')"><label>Сумма<input v-model="form.amount" type="number" min="0.01" max="999999999.99" step="0.01" inputmode="decimal" required></label><label>Валюта<select v-model="form.currency"><option>USD</option><option>EUR</option></select></label><label>Количество оплаченных уроков<input v-model="form.lessons_count" type="number" min="1" max="1000000" step="1" required></label><label>Дата<input v-model="form.date" type="date" required :max="today(zone)"></label><p class="form-preview">Баланс после сохранения: {{ currentBalance - (form.id ? record?.lessons_count || 0 : 0) + Number(form.lessons_count || 0) }}</p></template>
            <template v-else-if="screen === 'settings'"><p>{{ state.teacher.name }}</p><label>Часовой пояс<input v-model="form.timezone" required placeholder="Europe/Kyiv" list="timezones"><datalist id="timezones"><option>Europe/Kyiv</option><option>Europe/Warsaw</option><option>Europe/Berlin</option><option>Europe/London</option><option>America/New_York</option><option>Asia/Tokyo</option><option>UTC</option></datalist></label><p class="field-help">Определён при первом входе. Изменение пояса изменит отображение времени уроков, границы недель и статистики. Даты оплат сохранятся.</p></template>
            <button class="primary" :disabled="busy" type="submit">{{ busy ? 'Сохранение…' : 'Сохранить' }}</button>
          </form>
          <button v-if="screen === 'settings'" class="secondary" @click="navigate('premium')">{{ state.teacher.plan === 'premium' ? 'Ваш тариф Premium' : 'Тарифы и Premium' }}</button>
        </template>
        <template v-else-if="screen === 'lessons'">
          <h1>История уроков</h1><p class="field-help">{{ zone }}</p>
          <div class="card-list"><button v-for="l in allLessons.rows" :key="l.id" class="history-row" @click="openRecord('lesson', l)"><span><small>{{ lessonLabel(l) }}</small><strong>{{ studentName(l.student_id) }}</strong><small v-if="isTrashed(l.student_id)">Ученик в корзине</small><span class="note-preview">{{ l.feedback || 'Без обратной связи' }}</span></span><span class="chevron">›</span></button><p v-if="!allLessons.rows.length" class="empty">Добавьте проведённый урок из профиля ученика.</p></div>
          <Pagination :page="allLessons.page" :pages="allLessons.pages" @change="allPage = $event" />
        </template>
        <template v-else-if="screen === 'lesson' && record && student">
          <div class="section-heading lesson-heading"><h1>{{ student.name }}</h1><details v-if="!student.deleted_at" class="record-menu"><summary aria-label="Меню урока">⋮</summary><button class="text-button danger-text" :disabled="busy" @click="deleteRecord('lesson')">Удалить урок</button></details></div>
          <p>{{ lessonLabel(record) }} · {{ zone }}</p><section class="lesson-content"><h2>Обратная связь</h2><p>{{ record.feedback || 'Не добавлена' }}</p></section>
          <button v-if="!student.deleted_at" class="secondary" @click="begin('lesson-edit')">Редактировать</button><p v-else class="field-help">Для редактирования восстановите ученика из корзины.</p>
        </template>
        <template v-else-if="screen === 'payment' && record && student">
          <h1>{{ student.name }}</h1><div class="lesson-content"><h2>Оплата · {{ dateLabel(record.date) }}</h2><p>{{ paymentLabel(record) }}</p><p>+{{ record.lessons_count }} уроков</p></div>
          <template v-if="!student.deleted_at"><button class="secondary" @click="begin('payment-edit')">Редактировать</button><button class="secondary danger-text" :disabled="busy" @click="deleteRecord('payment')">Удалить оплату</button></template><p v-else class="field-help">Для редактирования восстановите ученика из корзины.</p>
        </template>
        <Statistics v-else-if="screen === 'stats'" :timezone="zone" />
        <template v-else-if="screen === 'trash'">
          <h1>Корзина <span class="count">{{ trash.length }}</span></h1><p class="field-help">Ученики хранятся 30 дней и занимают места тарифа.</p>
          <div v-for="s in trash" :key="s.id" class="stat-card"><button class="text-button" @click="openStudent(s.id)"><strong>{{ s.name }}</strong></button><p>Окончательное удаление: {{ deleteDate(s) }}</p><div class="trash-actions"><button class="text-button" :disabled="busy" @click="action('student.restore', { id: s.id })">Восстановить</button><button class="text-button danger-text" :disabled="busy" @click="removeStudent(s.id)">Удалить навсегда</button></div></div>
          <p v-if="!trash.length" class="empty">Корзина пуста.</p><button v-else class="secondary danger-text" :disabled="busy" @click="emptyTrash">Очистить корзину</button>
        </template>
        <template v-else-if="screen === 'premium'">
          <h1>Тарифы</h1><div class="stat-card"><h2>Free</h2><p>До 3 учеников и 10 уроков в неделю.</p></div><div class="stat-card"><h2>Premium</h2><p>До 100 учеников и 200 уроков в неделю.</p><p>{{ state.teacher.plan === 'premium' ? 'Ваш текущий тариф.' : 'Покупка подписки пока недоступна.' }}</p></div><p class="field-help">Лимит уроков считается по дате проведения с понедельника по воскресенье в вашем часовом поясе. Корзина занимает места тарифа.</p>
        </template>
      </template>
    </main>
    <nav v-if="state" class="bottom-nav" aria-label="Основная навигация"><button v-for="item in [{ id: 'students', label: 'Ученики', icon: '♙' }, { id: 'lessons', label: 'Уроки', icon: '▤' }, { id: 'stats', label: 'Статистика', icon: '▥' }, { id: 'trash', label: 'Корзина', icon: '♲' }]" :key="item.id" :class="{ active: screen === item.id }" :disabled="busy" @click="switchTab(item.id)"><span class="nav-icon" aria-hidden="true">{{ item.icon }}</span><span>{{ item.label }}</span></button></nav>
  </div>
</template>
