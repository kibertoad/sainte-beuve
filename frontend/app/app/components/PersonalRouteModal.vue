<script setup lang="ts">
import { rememberPersonalPassword } from '../utils/personalPassword'

// What a review on the person's own subscription still needs from them, asked
// once and then remembered: the password for 40 hours in this browser, the key
// on the server. Mounted once, in the shell; `usePersonalRoutePrompt` opens it.
const { pending, close } = usePersonalRoutePrompt()
const apiBase = useRuntimeConfig().public.apiBase
const password = ref('')

const open = computed({
  get: () => pending.value !== null,
  set: (value: boolean) => {
    if (!value) close()
  },
})

const vendor = computed(() => pending.value?.vendor ?? 'model')

const TITLES = {
  personal_key: 'Store your cat-factory key',
  password: 'Enter your personal password',
  wrong_password: 'That password did not work',
  subscription: 'Connect your subscription in cat-factory',
  subscription_expired: 'Your subscription has expired',
} as const

const title = computed(() => (pending.value === null ? '' : TITLES[pending.value.need]))

function again(): void {
  const retry = pending.value?.retry ?? null
  close()
  retry?.()
}

function submit(): void {
  if (password.value.length === 0) return
  rememberPersonalPassword(apiBase, password.value)
  password.value = ''
  again()
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <div v-if="pending?.need === 'personal_key'" class="flex flex-col gap-3">
        <p class="text-sm text-muted">
          AI reviews here run on a personal model subscription, which cat-factory opens only through
          a key you minted as yourself.
        </p>
        <CatFactoryPersonalKeyCard @saved="again()" />
      </div>
      <form
        v-else-if="pending?.need === 'password' || pending?.need === 'wrong_password'"
        class="flex flex-col gap-3"
        @submit.prevent="submit()"
      >
        <p class="text-sm text-muted">
          This review runs on your {{ vendor }} subscription in cat-factory, which your personal
          password unlocks. It is kept in this browser for 40 hours and sent only with the calls
          that file or answer a review.
        </p>
        <UInput
          v-model="password"
          type="password"
          autofocus
          class="w-full"
          aria-label="Personal password"
          placeholder="Personal password"
        />
        <div class="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <UButton variant="ghost" color="neutral" class="justify-center" @click="close()">
            Cancel
          </UButton>
          <UButton type="submit" class="justify-center" :disabled="password.length === 0">
            Unlock and continue
          </UButton>
        </div>
      </form>
      <p v-else class="text-sm text-muted">
        cat-factory holds no {{ pending?.need === 'subscription_expired' ? 'current ' : '' }}
        {{ vendor }} subscription for you. Connect or renew it in cat-factory, then try again.
      </p>
    </template>
  </UModal>
</template>
