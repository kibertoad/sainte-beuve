<script setup lang="ts">
import { blankToNull } from '../utils/text'

// "Not me", with room to say why. The reason is optional and shown to the
// requester, who otherwise has a name and no idea whether to ask again later.
defineProps<{ loading: boolean }>()

const emit = defineEmits<{ decline: [reason: string | null] }>()

const open = ref(false)
const reason = ref('')

function submit(): void {
  emit('decline', blankToNull(reason.value))
  open.value = false
  reason.value = ''
}
</script>

<template>
  <UPopover v-model:open="open">
    <UButton size="sm" variant="ghost" color="neutral" :loading="loading">Not me</UButton>

    <template #content>
      <form
        class="flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2 p-3"
        @submit.prevent="submit()"
      >
        <UInput
          v-model="reason"
          :maxlength="300"
          placeholder="Why not? Optional, shown to the requester"
          class="w-full"
          autofocus
        />
        <div class="flex justify-end">
          <UButton type="submit" size="sm" variant="soft" :loading="loading">Pass on it</UButton>
        </div>
      </form>
    </template>
  </UPopover>
</template>
