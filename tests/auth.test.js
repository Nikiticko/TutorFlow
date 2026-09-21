import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { validateTelegram } from '../server/auth.js'
// Synthetic test fixture, not a real bot credential.
const fixtureKey = 'unit-test-fixture', now = 1800000000000
export function sign(params, key) {
  const data = new URLSearchParams(params)
  const check = [...data].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(key).digest()
  data.set('hash', createHmac('sha256', secret).update(check).digest('hex'))
  return data.toString()
}
const input = (age = 0) => ({ auth_date: String(now / 1000 - age), user: JSON.stringify({ id: 123, first_name: 'Тест' }) })
test('Telegram: корректная подпись и пользователь', () => {
  assert.deepEqual(validateTelegram(sign(input(), fixtureKey), fixtureKey, now), { id: '123', name: 'Тест' })
})
test('Telegram: подмена, просроченные данные, дубликаты и отсутствующий токен отвергаются', () => {
  const valid = sign(input(), fixtureKey)
  assert.throws(() => validateTelegram(valid.replace('123', '456'), fixtureKey, now))
  assert.throws(() => validateTelegram(sign(input(3601), fixtureKey), fixtureKey, now))
  assert.throws(() => validateTelegram(sign(input(-60), fixtureKey), fixtureKey, now))
  assert.throws(() => validateTelegram(`${valid}&auth_date=1`, fixtureKey, now))
  assert.throws(() => validateTelegram(valid, '', now))
  assert.throws(() => validateTelegram('hash=bad', fixtureKey, now))
})
