<script setup>
import { computed, ref, watch } from 'vue'
import { DateTime } from 'luxon'
import { api } from '../api'
import { moneyLabel, periodBounds, today } from '../store'
const props = defineProps({ timezone: String })
const period = ref('week'), date = ref(today(props.timezone)), currency = ref('USD')
const stats = ref(null), loading = ref(false), error = ref('')
const colors = ['#2481cc', '#438c77', '#ad7137', '#9564cb', '#d45d80', '#4b9aa5', '#879837']
let request = 0
async function refresh() {
  const version = ++request
  loading.value = true; error.value = ''; stats.value = null
  try {
    const result = await api(`statistics?${new URLSearchParams({ period: period.value, date: date.value, currency: currency.value })}`)
    if (version === request) stats.value = result
  } catch (e) { if (version === request) error.value = e.message }
  finally { if (version === request) loading.value = false }
}
watch([period, date, currency, () => props.timezone], refresh, { immediate: true })
function move(amount) {
  if (!DateTime.fromISO(date.value).isValid) return
  const { start } = periodBounds(period.value, date.value, props.timezone)
  date.value = start.plus({ [period.value]: amount }).toISODate()
}
const atCurrent = computed(() => !DateTime.fromISO(date.value).isValid || periodBounds(period.value, date.value, props.timezone).end > DateTime.now().setZone(props.timezone))
const pie = computed(() => {
  let position = 0
  return `conic-gradient(${stats.value.students.map((s, i) => {
    const start = position; position += s.count / stats.value.count * 100
    return `${colors[i % colors.length]} ${start}% ${position}%`
  }).join(',')})`
})
const maxLessons = computed(() => Math.max(1, ...stats.value.buckets.map(b => b.lessons)))
const maxPayments = computed(() => Math.max(1, ...stats.value.buckets.map(b => b.paid ?? 0)))
</script>
<template>
  <h1>Статистика</h1>
  <div class="stat-filters">
    <label>Период<select v-model="period" aria-label="Период"><option value="week">Неделя</option><option value="month">Месяц</option><option value="year">Год</option></select></label>
    <label>Валюта<select v-model="currency" aria-label="Валюта"><option>USD</option><option>EUR</option></select></label>
  </div>
  <div class="month-switch">
    <button class="icon-button" aria-label="Предыдущий период" @click="move(-1)">←</button>
    <label class="period-date">Дата периода<input v-model="date" type="date" :max="today(timezone)" required></label>
    <button class="icon-button" aria-label="Следующий период" :disabled="atCurrent" @click="move(1)">→</button>
  </div>
  <p v-if="loading" role="status">Загрузка статистики…</p>
  <div v-if="error" class="notice" role="alert">{{ error }}<button class="text-button" @click="refresh">Повторить</button></div>
  <template v-if="stats">
    <p class="field-help">{{ stats.start }} — {{ stats.end }} · {{ timezone }}</p>
    <section class="stat-card"><h2>Уроки по ученикам · {{ stats.count }}</h2>
      <div v-if="stats.count" class="pie-chart" :style="{ background: pie }" role="img" :aria-label="`Распределение ${stats.count} уроков между учениками`"></div>
      <p v-else class="empty">В этом периоде уроков нет.</p>
      <ul class="chart-legend"><li v-for="(s, i) in stats.students" :key="s.id"><span class="legend-dot" :style="{ background: colors[i % colors.length] }"></span><span>{{ s.name }}</span><strong>{{ s.count }}</strong></li></ul>
    </section>
    <section class="stat-card"><h2>Проведённые уроки</h2>
      <div class="chart-scroll"><div class="bars" :style="{ minWidth: `${stats.buckets.length * 36}px` }">
        <div v-for="b in stats.buckets" :key="b.key" class="bar-column" :title="`${b.key}: ${b.lessons} уроков`"><span>{{ b.lessons }}</span><div class="bar-track"><div class="bar" :style="{ height: `${b.lessons / maxLessons * 100}%` }"></div></div><small>{{ b.label }}</small></div>
      </div></div>
    </section>
    <section class="stat-card"><h2>Полученные оплаты</h2><strong>{{ moneyLabel(stats.paid) }} <small v-if="stats.paid !== null">{{ currency }}</small></strong>
      <p v-if="stats.rateDate">Конвертация по курсу от {{ stats.rateDate }}.</p>
      <div v-if="stats.rateError" class="notice" role="alert">{{ stats.rateError }}<button class="text-button" @click="refresh">Обновить курс</button></div>
      <div v-if="stats.paid !== null" class="chart-scroll"><div class="bars" :style="{ minWidth: `${stats.buckets.length * 60}px` }">
        <div v-for="b in stats.buckets" :key="b.key" class="bar-column" :title="`${b.key}: ${moneyLabel(b.paid)} ${currency}${b.converted ? ' · конвертация' : ''}`"><span>{{ moneyLabel(b.paid) }}<small v-if="b.converted" aria-label="Конвертация"> ↔</small></span><div class="bar-track"><div class="bar payment-bar" :style="{ height: `${b.paid / maxPayments * 100}%` }"></div></div><small>{{ b.label }}</small></div>
      </div></div>
      <p v-if="stats.converted && stats.paid !== null">↔ Конвертация в {{ currency }}. Значения с округлением отмечены ≈.</p>
    </section>
  </template>
</template>
