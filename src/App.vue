<script setup>
import { computed, nextTick, reactive, ref } from 'vue'
import { useTelegram } from './composables/useTelegram'
import { seed, today, localDate, uid, saveLesson, savePayment, statistics } from './store'
const storageKey='tutorflow-v1'
let initial, loadError=''
try { const raw=localStorage.getItem(storageKey); initial=raw?JSON.parse(raw):seed(); if(!initial.teacher||!Array.isArray(initial.students)||!Array.isArray(initial.lessons)||!Array.isArray(initial.payments)) throw Error() } catch { initial=seed(); loadError='Не удалось прочитать сохранённые данные. Показаны демоданные; изменения не будут сохранены.' }
const state=reactive(initial), screen=ref('students'), tab=ref('students'), studentId=ref(null), lessonId=ref(null), error=ref(''), storageError=ref(loadError), form=reactive({}), success=ref(null), saving=ref(false)
const history = ref([])
const canGoBack = computed(() => history.value.length > 0)
const { isTelegram, nativeBack } = useTelegram({ canGoBack, onBack: back })
const student=computed(()=>state.students.find(s=>s.id===studentId.value))
const lesson=computed(()=>state.lessons.find(l=>l.id===lessonId.value))
const sorted=(rows)=>[...rows].sort((a,b)=>b.date.localeCompare(a.date)||b.created_at.localeCompare(a.created_at))
const studentLessons=computed(()=>sorted(state.lessons.filter(l=>l.student_id===studentId.value)))
const studentPayments=computed(()=>sorted(state.payments.filter(p=>p.student_id===studentId.value)))
const allLessons=computed(()=>sorted(state.lessons))
const month=ref(today().slice(0,7)), stats=computed(()=>statistics(state,month.value))
const monthLabel=computed(()=>new Date(`${month.value}-01T12:00:00`).toLocaleDateString('ru-RU',{month:'long',year:'numeric'}).replace(' г.',''))
const currency=computed(()=>({UAH:'грн',USD:'$',EUR:'€'}[state.teacher.currency]))
const money=(v)=>`${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(v)} ${currency.value}`
const plural=(n)=>{const a=Math.abs(n)%100,b=a%10;return a>10&&a<20?'занятий':b===1?'занятие':b>=2&&b<=4?'занятия':'занятий'}
const dateLabel=(d,year=false)=>new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'long',...(year?{year:'numeric'}:{})})
const initials=(name)=>name.trim().slice(0,1).toUpperCase()
const findStudent=(id)=>state.students.find(s=>s.id===id)
const groups=computed(()=>{const result=[];for(const l of allLessons.value){let g=result.at(-1);if(g?.date!==l.date){g={date:l.date,lessons:[]};result.push(g)}g.lessons.push(l)}return result})
function persist(){if(loadError)return;try{localStorage.setItem(storageKey,JSON.stringify(state));storageError.value=''}catch{storageError.value='Не удалось сохранить данные в браузере. Изменения доступны только до закрытия страницы.'}}
function navigate(next, { replace = false } = {}) {
  if (!replace && next !== screen.value) {
    history.value.push({ screen: screen.value, studentId: studentId.value, lessonId: lessonId.value })
  }
  screen.value = next
  error.value = ''
  success.value = null
  nextTick(() => window.scrollTo(0, 0))
}
function switchTab(next) {
  tab.value = next
  history.value = []
  navigate(next, { replace: true })
}
function openStudent(id) { navigate('student'); studentId.value = id }
function openLesson(l) { navigate('lesson'); lessonId.value = l.id; studentId.value = l.student_id }
function begin(type) {
  for (const key of Object.keys(form)) delete form[key]
  form.id = uid()
  if (type === 'student-form') Object.assign(form, { name: '', subject: '', lesson_price: '' })
  if (type === 'student-edit') Object.assign(form, student.value)
  if (type === 'payment') Object.assign(form, { date: today(), lessons_count: 8, amount: student.value.lesson_price * 8 })
  if (type === 'lesson-form') Object.assign(form, { date: today(), lesson_note: '', feedback: '', homework: '' })
  if (type === 'lesson-edit') Object.assign(form, lesson.value)
  if (type === 'settings') Object.assign(form, state.teacher)
  navigate(type)
}
function back() {
  const previous = history.value.pop()
  if (!previous) return
  studentId.value = previous.studentId
  lessonId.value = previous.lessonId
  navigate(previous.screen, { replace: true })
}
function returnToStudent() {
  back()
}
function submit(){if(saving.value)return;saving.value=true;error.value='';try{
 const type=screen.value
 if(type==='student-form'||type==='student-edit'){
 const price=Number(form.lesson_price);if(!form.name.trim()||!Number.isFinite(price)||price<=0)throw Error('Укажите имя и стоимость занятия больше нуля.')
 const values={name:form.name.trim(),subject:form.subject.trim(),lesson_price:price}
 if(type==='student-edit'){Object.assign(student.value,values);back()}else{const s={id:form.id,...values,lesson_balance:0,created_at:new Date().toISOString()};state.students.push(s);studentId.value=s.id;navigate('student',{replace:true})}
 }else if(type==='payment'){
 const before=student.value.lesson_balance;savePayment(state,studentId.value,form,form.id);navigate('success',{replace:true});success.value={title:'Оплата добавлена',before,after:student.value.lesson_balance,amount:Number(form.amount),kind:'payment'}
 }else if(type==='lesson-form'||type==='lesson-edit'){
 const before=student.value.lesson_balance;const l=saveLesson(state,studentId.value,form,form.id);lessonId.value=l.id
 if(type==='lesson-edit')back();else{navigate('success',{replace:true});success.value={title:'Урок сохранён',before,after:student.value.lesson_balance,amount:l.price,kind:'lesson'}}
 }else if(type==='settings'){if(!form.name.trim())throw Error('Укажите имя преподавателя.');Object.assign(state.teacher,{name:form.name.trim(),currency:form.currency});back()}
 persist()
 }catch(e){error.value=e.message}finally{saving.value=false}}
function changeMonth(offset){const d=new Date(`${month.value}-01T12:00:00`);d.setMonth(d.getMonth()+offset);month.value=localDate(d).slice(0,7)}
const formTitle=computed(()=>({'student-form':'Новый ученик','student-edit':'Редактировать ученика',payment:'Добавить оплату','lesson-form':'Проведённый урок','lesson-edit':'Редактировать урок',settings:'Настройки'}[screen.value]))
</script>

<template>
 <div class="app-shell" :class="{'in-telegram': isTelegram}">
  <header class="app-toolbar">
    <span v-if="!isTelegram" class="preview-label">TutorFlow · предпросмотр</span>
    <button class="icon-button" aria-label="Настройки" @click="begin('settings')" v-if="['students', 'lessons', 'stats'].includes(screen)">
      <svg viewBox="0 0 24 24"><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
  </header>
  <main>
   <div v-if="storageError" class="notice danger" role="alert">{{ storageError }}</div>
   <template v-if="screen==='students'">
    <div class="page-heading"><div><h1>Ученики<span class="count">{{state.students.length}}</span></h1></div></div>
    <div class="student-list"><button v-for="(s,i) in state.students" :key="s.id" class="student-card" @click="openStudent(s.id)"><span class="avatar" :class="`color-${i%3}`">{{initials(s.name)}}</span><span class="student-info"><strong>{{s.name}}</strong><span>{{s.subject||'Предмет не указан'}}</span></span><span class="balance-mini" :class="{low:s.lesson_balance===1,negative:s.lesson_balance<=0}"><strong><span v-if="s.lesson_balance<=1" class="warning-mark">!</span>{{s.lesson_balance}} {{plural(s.lesson_balance)}}</strong><small>{{s.lesson_balance<=0?'Нужна оплата':s.lesson_balance===1?'Скоро пополнить':'На балансе'}}</small></span><span class="chevron">›</span></button></div>
    <div v-if="!state.students.length" class="empty">Добавьте первого ученика, чтобы начать вести журнал.</div>
    <button class="primary add-student" @click="begin('student-form')"><span>＋</span> Добавить ученика</button>
   </template>

   <template v-else-if="screen==='student'">
    <button v-if="!nativeBack" class="back" @click="back">← Ученики</button>
    <div class="profile"><span class="avatar large color-0">{{initials(student.name)}}</span><div><h1>{{student.name}}</h1><p>{{student.subject||'Предмет не указан'}}</p></div><button class="icon-button edit" aria-label="Редактировать ученика" @click="begin('student-edit')">✎</button></div>
    <p class="price-label">{{money(student.lesson_price)}} <span>/ занятие</span></p>
    <div class="balance-card" :class="{low:student.lesson_balance===1,negative:student.lesson_balance<=0}"><span>Баланс занятий</span><strong>{{student.lesson_balance}} <small>{{plural(student.lesson_balance)}}</small></strong><p v-if="student.lesson_balance<=0">{{student.lesson_balance<0?'Есть неоплаченные занятия':'Нужно пополнить баланс'}} · урок можно записать</p><p v-else-if="student.lesson_balance===1">Осталось одно оплаченное занятие</p></div>
    <button class="primary" @click="begin('lesson-form')">＋ Проведён урок</button><button class="secondary" @click="begin('payment')">＋ Добавить оплату</button>
    <div class="section-heading"><h2>Последние уроки</h2><button class="text-button" @click="navigate('history')">Все уроки →</button></div>
    <div class="card-list"><button v-for="l in studentLessons.slice(0,3)" :key="l.id" class="history-row" @click="openLesson(l)"><span><small>{{dateLabel(l.date)}}</small><strong>{{l.lesson_note}}</strong><span class="completed">✓ Проведён</span></span><span class="chevron">›</span></button><p v-if="!studentLessons.length" class="empty">Здесь появятся проведённые уроки.</p></div>
    <div class="section-heading"><h2>Последние оплаты</h2></div><div class="card-list"><div v-for="p in studentPayments" :key="p.id" class="payment-row"><span><strong>{{dateLabel(p.date)}}</strong><small>+{{p.lessons_count}} {{plural(p.lessons_count)}}</small></span><strong>{{money(p.amount)}}</strong></div><p v-if="!studentPayments.length" class="empty">Оплат пока нет.</p></div>
   </template>

   <template v-else-if="formTitle">
    <button v-if="!nativeBack" class="back" @click="back">← Назад</button><h1>{{formTitle}}</h1><p class="form-subtitle">{{screen==='settings'?'Ваш личный журнал':screen==='student-form'?'':student?.name}}</p>
    <form @submit.prevent="submit" class="form">
     <template v-if="screen==='student-form'||screen==='student-edit'"><label>Имя <span>*</span><input v-model="form.name" required maxlength="80" placeholder="Давид" autocomplete="off"></label><label>Предмет<input v-model="form.subject" maxlength="100" placeholder="Например, Roblox"></label><label>Стоимость одного занятия, {{currency}} <span>*</span><input v-model="form.lesson_price" required type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="500"></label><p v-if="screen==='student-edit'" class="field-help">Новая стоимость применяется к новым записям уроков. История сохраняет прежнюю стоимость.</p></template>
     <template v-else-if="screen==='payment'"><label>Количество оплаченных занятий <span>*</span><input v-model="form.lessons_count" @input="form.amount=Number(form.lessons_count)*student.lesson_price" required type="number" min="1" step="1" inputmode="numeric"></label><label>Сумма оплаты, {{currency}} <span>*</span><input v-model="form.amount" required type="number" min="0.01" step="0.01" inputmode="decimal"></label><label>Дата<input v-model="form.date" required type="date" :max="today()"></label><div class="form-preview">Баланс после оплаты <strong>{{student.lesson_balance+Number(form.lessons_count||0)}} {{plural(student.lesson_balance+Number(form.lessons_count||0))}}</strong></div></template>
     <template v-else-if="screen==='lesson-form'||screen==='lesson-edit'"><label>Дата урока<input v-model="form.date" required type="date" :max="today()"></label><label>Что делали на уроке? <span>*</span><textarea v-model="form.lesson_note" required rows="4" placeholder="Тема урока и что успели разобрать"></textarea></label><label>Обратная связь<textarea v-model="form.feedback" rows="4" placeholder="Что получилось хорошо, а что ещё нужно повторить"></textarea></label><label>Домашнее задание<textarea v-model="form.homework" rows="3" placeholder="Что сделать к следующему занятию"></textarea></label><div class="form-preview">{{screen==='lesson-edit'?'Баланс не изменится':'С баланса спишется 1 занятие'}}<strong>{{screen==='lesson-edit'?money(lesson.price):`${student.lesson_balance} → ${student.lesson_balance-1}`}}</strong></div></template>
     <template v-else-if="screen==='settings'"><label>Имя преподавателя<input v-model="form.name" required maxlength="80"></label><label>Валюта<select v-model="form.currency"><option value="UAH">UAH · Украинская гривна</option><option value="USD">USD · Доллар США</option><option value="EUR">EUR · Евро</option></select></label><p class="field-help">Валюта применяется ко всему журналу. Суммы не пересчитываются.</p></template>
     <p v-if="error" class="notice danger" role="alert">{{error}}</p><button class="primary" :disabled="saving" type="submit">{{screen==='student-form'?'Добавить':screen==='payment'?'Добавить оплату':screen==='lesson-form'?'Сохранить урок':'Сохранить'}}</button>
    </form>
   </template>

   <template v-else-if="screen==='success'&&success"><div class="success-view"><div class="success-icon">✓</div><div class="eyebrow">{{student.name}}</div><h1>{{success.title}}</h1><p>{{success.kind==='lesson'?'Занятие списано с баланса.':'Баланс пополнен.'}}</p><div class="success-summary"><span>Баланс занятий</span><strong><span>{{success.before}}</span><i>→</i>{{success.after}}</strong><div>{{success.kind==='lesson'?'Учтено':'Получено'}}<b>{{money(success.amount)}}</b></div></div><button class="primary" @click="returnToStudent">Вернуться к ученику →</button></div></template>

   <template v-else-if="screen==='lessons'||screen==='history'">
    <button v-if="screen==='history' && !nativeBack" class="back" @click="back">← К ученику</button><h1>{{screen==='history'?`${student.name} — уроки`:'Уроки'}}</h1>
    <template v-if="screen==='lessons'"><div v-for="g in groups" :key="g.date"><div class="section-label date-group">{{g.date===today()?'Сегодня':dateLabel(g.date,true)}}</div><div class="card-list"><button v-for="l in g.lessons" :key="l.id" class="journal-row" @click="openLesson(l)"><span class="avatar color-0">{{initials(findStudent(l.student_id).name)}}</span><span class="student-info"><strong>{{findStudent(l.student_id).name}}</strong><span>{{findStudent(l.student_id).subject}}</span><small class="note-preview">{{l.lesson_note}}</small></span><strong class="journal-price">{{money(l.price)}}</strong><span class="chevron">›</span></button></div></div><div v-if="!allLessons.length" class="empty">Проведённых уроков пока нет. Добавьте урок из карточки ученика.</div></template>
    <div v-else class="card-list"><button v-for="l in studentLessons" :key="l.id" class="history-row" @click="openLesson(l)"><span><small>{{dateLabel(l.date,true)}}</small><strong>{{l.lesson_note}}</strong><span class="completed">✓ Проведён</span></span><span class="chevron">›</span></button><div v-if="!studentLessons.length" class="empty">Уроков пока нет.</div></div>
   </template>

   <template v-else-if="screen==='lesson'"><button v-if="!nativeBack" class="back" @click="back">← История уроков</button><div class="section-heading lesson-heading"><h1>{{student.name}}</h1><span class="status">✓ Проведён</span></div><p class="form-subtitle">{{dateLabel(lesson.date,true)}} · {{student.subject}}</p><div class="lesson-content"><section><h2>На уроке</h2><p>{{lesson.lesson_note}}</p></section><section><h2>Обратная связь</h2><p>{{lesson.feedback||'Не добавлена'}}</p></section><section><h2>Домашнее задание</h2><p>{{lesson.homework||'Не задано'}}</p></section><div class="lesson-cost"><span>Стоимость</span><strong>{{money(lesson.price)}}</strong></div></div><button class="secondary" @click="begin('lesson-edit')">✎ Редактировать</button></template>

   <template v-else-if="screen==='stats'"><h1>Статистика</h1><div class="month-switch"><button class="icon-button" aria-label="Предыдущий месяц" @click="changeMonth(-1)">←</button><strong>{{monthLabel}}</strong><button class="icon-button" aria-label="Следующий месяц" @click="changeMonth(1)">→</button></div><div class="stat-card"><span class="stat-icon lilac">✓</span><span>Проведено</span><strong>{{stats.count}} <small>уроков</small></strong><p>Занятия, которые уже состоялись</p></div><div class="stat-card"><span class="stat-icon green">↗</span><span>Заработано</span><strong>{{money(stats.earned)}}</strong><p>Стоимость проведённых уроков</p></div><div class="stat-card"><span class="stat-icon peach">＋</span><span>Получено оплат</span><strong>{{money(stats.paid)}}</strong><p>Все внесённые оплаты за месяц</p></div></template>
  </main>
  <nav class="bottom-nav" aria-label="Основная навигация"><button :class="{active:tab==='students'}" @click="switchTab('students')"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1"/></svg><span>Ученики</span></button><button :class="{active:tab==='lessons'}" @click="switchTab('lessons')"><svg viewBox="0 0 24 24"><rect x="5" y="3" width="15" height="18" rx="3"/><path d="M3 7h4M3 12h4M3 17h4m3-9h6m-6 4h6m-6 4h4"/></svg><span>Уроки</span></button><button :class="{active:tab==='stats'}" @click="switchTab('stats')"><svg viewBox="0 0 24 24"><path d="M4 20V10m8 10V4m8 16v-7"/></svg><span>Статистика</span></button></nav>
 </div>
</template>
