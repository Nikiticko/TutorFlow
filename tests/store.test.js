import test from 'node:test'
import assert from 'node:assert/strict'
import {seed,today,saveLesson,savePayment,statistics} from '../src/store.js'
const form=()=>({date:today(),lesson_note:'Функции',feedback:'Хорошо',homework:'Практика'})
test('Основной сценарий: урок, оплата и статистика',()=>{
 const state=seed(),s=state.students[0],before=statistics(state,today().slice(0,7))
 saveLesson(state,s.id,form(),'new-lesson');assert.equal(s.lesson_balance,2)
 savePayment(state,s.id,{date:today(),lessons_count:8,amount:4000},'new-payment');assert.equal(s.lesson_balance,10)
 assert.deepEqual(statistics(state,today().slice(0,7)),{count:before.count+1,earned:before.earned+500,paid:before.paid+4000})
})
test('Повторное сохранение и редактирование не списывают баланс; цена историческая',()=>{
 const state=seed(),s=state.students[0];saveLesson(state,s.id,form(),'lesson');s.lesson_price=900
 saveLesson(state,s.id,{...form(),lesson_note:'Новая тема'},'lesson')
 assert.equal(s.lesson_balance,2);assert.equal(state.lessons.find(l=>l.id==='lesson').price,500)
 assert.equal(state.lessons.filter(l=>l.id==='lesson').length,1)
})
test('Отрицательный баланс разрешён; повторная оплата не зачисляется',()=>{
 const state=seed(),s=state.students[2];saveLesson(state,s.id,form(),'negative');assert.equal(s.lesson_balance,-1)
 const p={date:today(),lessons_count:2,amount:1000};savePayment(state,s.id,p,'p');savePayment(state,s.id,p,'p');assert.equal(s.lesson_balance,1)
})
test('Некорректные данные не меняют состояние',()=>{
 const state=seed(),original=JSON.stringify(state)
 assert.throws(()=>saveLesson(state,'s0',{...form(),date:'9999-01-01'},'future'))
 assert.throws(()=>saveLesson(state,'s0',{...form(),lesson_note:' '},'empty'))
 assert.throws(()=>savePayment(state,'s0',{date:today(),lessons_count:1.5,amount:500},'bad'))
 assert.throws(()=>savePayment(state,'s0',{date:today(),lessons_count:1,amount:-500},'bad'))
 assert.equal(JSON.stringify(state),original)
})
test('Пустой месяц содержит нулевые итоги',()=>assert.deepEqual(statistics(seed(),'1900-01'),{count:0,earned:0,paid:0}))
