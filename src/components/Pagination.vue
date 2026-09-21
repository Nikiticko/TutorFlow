<script setup>
defineProps({ page: Number, pages: Number })
defineEmits(['change'])
</script>
<template>
  <div v-if="pages > 1" class="pagination" aria-label="Страницы истории">
    <button class="icon-button" :disabled="page <= 1" aria-label="Предыдущая страница" @click="$emit('change', page - 1)">←</button>
    <span>{{ page }} / {{ pages }}</span>
    <button class="icon-button" :disabled="page >= pages" aria-label="Следующая страница" @click="$emit('change', page + 1)">→</button>
  </div>
</template>
