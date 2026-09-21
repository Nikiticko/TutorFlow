import { onMounted, onUnmounted, watch } from 'vue'

// Theme/navigation integration only; authentication is verified by the backend.
export function useTelegram({ canGoBack, onBack }) {
  const app = window.Telegram?.WebApp
  const isTelegram = Boolean(app && app.platform !== 'unknown')
  const nativeBack = isTelegram && app.isVersionAtLeast('6.1')
  let stopWatching

  function syncTheme() {
    document.documentElement.style.colorScheme = app.colorScheme
    document.documentElement.dataset.theme = app.colorScheme
    if (app.isVersionAtLeast('6.1')) {
      app.setHeaderColor('secondary_bg_color')
      app.setBackgroundColor(app.themeParams.secondary_bg_color || app.themeParams.bg_color || '#efeff4')
    }
  }

  onMounted(() => {
    if (!isTelegram) return
    syncTheme()
    app.onEvent('themeChanged', syncTheme)
    app.expand()
    if (nativeBack) {
      app.BackButton.onClick(onBack)
      stopWatching = watch(canGoBack, value => {
        if (value) app.BackButton.show()
        else app.BackButton.hide()
      }, { immediate: true })
    }
    app.ready()
  })

  onUnmounted(() => {
    stopWatching?.()
    if (!isTelegram) return
    app.offEvent('themeChanged', syncTheme)
    if (nativeBack) {
      app.BackButton.offClick(onBack)
      app.BackButton.hide()
    }
  })

  return { isTelegram, nativeBack }
}
