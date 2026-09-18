<script setup lang="ts">
// The one dialog that asks "are you sure", mounted ONCE in the shell.
//
// It renders whatever `useConfirm` is currently asking and nothing else. The
// question, its wording and the promise waiting on the answer all live in the
// composable, so a screen adds a confirmation by awaiting a function rather than
// by carrying a modal, a boolean and a held callback of its own.
//
// Dismissing it — the close button, Escape, a click outside — is a NO. That is
// the safe direction for every question it is ever asked: each one is about
// destroying something, so the ambiguous answer has to be the one that leaves
// the thing alone.
const { pending } = useConfirm()

const open = computed({
  get: () => pending.value !== null,
  set: (value: boolean) => {
    if (!value) pending.value?.settle(false)
  },
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="pending?.title ?? ''"
    :description="pending?.description ?? ''"
  >
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton variant="ghost" color="neutral" @click="pending?.settle(false)">Cancel</UButton>
        <UButton color="error" @click="pending?.settle(true)">
          {{ pending?.confirmLabel }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
