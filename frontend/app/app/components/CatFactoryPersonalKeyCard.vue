<script setup lang="ts">
import type { CatFactoryPersonal } from '@sainte-beuve/contracts'

// The caller's own cat-factory key, which cat-factory runs their model
// subscription through. It loads and saves for itself, because it is shown
// to anyone who files a review, not only on the admin's Configuration screen.
const emit = defineEmits<{ saved: [] }>()

const api = useSainteBeuveApi()
const personal = ref<CatFactoryPersonal | null>(null)
const draft = ref('')
const { busy, run } = useApiAction()

async function load(): Promise<void> {
  try {
    personal.value = await api.getCatFactoryPersonal()
  } catch {
    personal.value = null
  }
}

async function save(): Promise<void> {
  const stored = await run(
    async () => {
      personal.value = await api.setCatFactoryPersonalKey(draft.value.trim())
    },
    'Could not store your cat-factory key',
    'save',
  )
  if (stored) {
    draft.value = ''
    emit('saved')
  }
}

async function remove(): Promise<void> {
  await run(
    async () => {
      personal.value = await api.clearCatFactoryPersonalKey()
    },
    'Could not remove your cat-factory key',
    'remove',
  )
}

onMounted(load)
</script>

<template>
  <UCard>
    <div class="flex flex-col-reverse gap-2 mb-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="min-w-0">
        <p class="font-medium">Your cat-factory key</p>
        <p class="text-sm text-muted">
          For AI reviews on your own model subscription. Mint it in cat-factory under API access
          tokens with "Runs as" set to yourself and the decide scope. Sealed before it is stored and
          sent only to this org's cat-factory. Your personal password is asked for when a review
          needs it, kept in this browser for 40 hours, and never stored here.
        </p>
      </div>
      <UBadge
        :color="personal?.key.stored ? 'success' : 'neutral'"
        variant="subtle"
        class="self-start sm:shrink-0"
      >
        {{ personal?.key.stored ? `Stored, ends ${personal.key.hint}` : 'Not stored' }}
      </UBadge>
    </div>
    <div class="flex flex-col gap-2 sm:flex-row">
      <UInput
        v-model="draft"
        type="password"
        class="w-full"
        placeholder="cf_live_…"
        aria-label="Your cat-factory key"
      />
      <UButton
        class="justify-center"
        :loading="busy === 'save'"
        :disabled="draft.trim().length === 0"
        @click="save()"
      >
        Save key
      </UButton>
      <UButton
        v-if="personal?.key.stored"
        variant="ghost"
        color="error"
        class="justify-center"
        :loading="busy === 'remove'"
        @click="remove()"
      >
        Remove
      </UButton>
    </div>
  </UCard>
</template>
