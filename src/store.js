export const today = () => localDate(new Date())
export function localDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
export function seed() {
  const date = today(), created_at = new Date().toISOString()
  const students = [ ['Давид','Roblox',500,3], ['Максим','Python',600,1], ['Саша','Roblox',500,0] ].map(([name,subject,lesson_price,lesson_balance],i)=>({id:`s${i}`,name,subject,lesson_price,lesson_balance,created_at}))
  const lessons = [], payments = []
  students.forEach((s,i)=>{
    const count = 3-i
    payments.push({id:`p${i}`,student_id:s.id,date,lessons_count:s.lesson_balance+count,amount:(s.lesson_balance+count)*s.lesson_price,created_at})
    for(let n=0;n<count;n++) {
      const d = new Date(); d.setDate(d.getDate()-n*3-i)
      lessons.push({id:`l${i}${n}`,student_id:s.id,date:localDate(d),lesson_note:s.subject==='Python'?'Функции и аргументы. Практиковались писать небольшие программы.':['NPC и простые скрипты. Повторили переменные и добавили персонажа в игру.','Функции. Учились объединять действия в один блок.','Циклы. Разобрали повторяющиеся действия.'][n],feedback:'Хорошо справился с заданиями. В самостоятельной работе пока требуется небольшая помощь.',homework:'Повторить примеры с урока и написать два своих скрипта.',price:s.lesson_price,created_at})
    }
  })
  return {teacher:{id:'teacher',name:'Александр',currency:'UAH'},students,lessons,payments}
}
export function saveLesson(state, studentId, form, id) {
  if(!form.date || form.date>today()) throw Error('Укажите дату уже проведённого урока.')
  if(!form.lesson_note.trim()) throw Error('Напишите, что делали на уроке.')
  const existing = state.lessons.find(l=>l.id===id)
  if(existing) { Object.assign(existing,{date:form.date,lesson_note:form.lesson_note.trim(),feedback:form.feedback.trim(),homework:form.homework.trim()}); return existing }
  const s = state.students.find(s=>s.id===studentId)
  if(!s) throw Error('Ученик не найден.')
  const lesson = {id,student_id:s.id,date:form.date,lesson_note:form.lesson_note.trim(),feedback:form.feedback.trim(),homework:form.homework.trim(),price:s.lesson_price,created_at:new Date().toISOString()}
  state.lessons.push(lesson); s.lesson_balance--; return lesson
}
export function savePayment(state, studentId, form, id) {
  if(state.payments.some(p=>p.id===id)) return
  const count=Number(form.lessons_count), amount=Number(form.amount)
  if(!Number.isSafeInteger(count)||count<=0||!Number.isFinite(amount)||amount<=0) throw Error('Укажите положительную сумму и целое количество занятий.')
  if(!form.date || form.date>today()) throw Error('Дата оплаты не может быть в будущем.')
  const s=state.students.find(s=>s.id===studentId)
  if(!s) throw Error('Ученик не найден.')
  state.payments.push({id,student_id:studentId,date:form.date,lessons_count:count,amount,created_at:new Date().toISOString()}); s.lesson_balance+=count
}
export function statistics(state, month) {
  const lessons=state.lessons.filter(l=>l.date.startsWith(month))
  return {count:lessons.length,earned:lessons.reduce((sum,l)=>sum+l.price,0),paid:state.payments.filter(p=>p.date.startsWith(month)).reduce((sum,p)=>sum+p.amount,0)}
}
