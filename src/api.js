export async function api(path, payload) {
  let response
  try {
    response = await fetch(`/api/${path}`, {
      credentials: 'same-origin',
      ...(payload === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
    })
  } catch { throw new Error('Нет связи с сервером. Проверьте подключение; перед повторным сохранением обновите данные.') }
  let data
  try { data = await response.json() } catch { throw new Error('Сервер вернул некорректный ответ. Проверьте запуск backend.') }
  if (!response.ok) { const error = new Error(data.message); error.code = data.code; error.status = response.status; throw error }
  return data
}
