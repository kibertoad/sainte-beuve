<script setup lang="ts">
import type {
  IntegrationTokenState,
  IntegrationTokenStatus,
  IntegrationTokenUnreadableReason,
} from '@sainte-beuve/contracts'

// One stored credential: what state it is in, and the only two things that can be
// done to it. A token is write-only here because it is write-only in the API, so
// this component can show which credential is stored and never what it is.
//
// It owns no API call. The page does, because saving one credential can change
// which OTHER one is in force, and only the page can re-read both.
const props = defineProps<{
  status: IntegrationTokenStatus
  /** What this credential is for, in the operator's words. */
  description: string
  placeholder?: string
  busy?: boolean
}>()

const emit = defineEmits<{ save: [token: string]; clear: [] }>()

const draft = ref('')

/** Trimmed, and the same test the Save button is disabled by: whitespace is not a token. */
const token = computed(() => draft.value.trim())

const STATE_LABEL = {
  absent: 'Not configured',
  stored: 'Configured',
  unreadable: 'Unreadable',
} satisfies Record<IntegrationTokenState, string>

const STATE_COLOR = {
  absent: 'neutral',
  stored: 'success',
  unreadable: 'error',
} satisfies Record<IntegrationTokenState, 'neutral' | 'success' | 'error'>

/** Each fault gets the instruction that fixes it, because they do not share one. */
const UNREADABLE_COPY = {
  no_key: {
    title: 'This deployment has no usable encryption key',
    description:
      'The stored token cannot be opened, and a replacement cannot be stored either, until ' +
      'SETTINGS_ENCRYPTION_KEY holds a usable key.',
  },
  key_mismatch: {
    title: 'This token was sealed under a different encryption key',
    description:
      'Restore the key it was sealed under, or enter the token again to seal it under the ' +
      'current one.',
  },
  corrupt: {
    title: 'This token is not a readable envelope',
    description:
      'The stored value is truncated, altered, or was written by another encryption scheme. ' +
      'No key opens it: enter the token again.',
  },
} satisfies Record<IntegrationTokenUnreadableReason, { title: string; description: string }>

// The API is versioned separately from this SPA, so a deployment can serve a newer
// backend than the bundle it built: a state this build has never heard of has to
// render as itself rather than throw and blank the whole page.
function lookup<T>(table: Record<string, T | undefined>, key: string): T | undefined {
  return table[key]
}

/**
 * Stored and in use are two different facts, so the badge says which one it
 * means: a green "Configured" on a credential nothing reads claims a capability
 * the deployment does not have.
 */
const badge = computed(() => {
  const { state, inUse } = props.status
  if (state === 'stored' && !inUse)
    return { color: 'warning' as const, label: 'Stored, not in use' }
  return {
    color: lookup(STATE_COLOR, state) ?? ('neutral' as const),
    label: lookup(STATE_LABEL, state) ?? state,
  }
})

const unreadable = computed(
  () =>
    lookup(UNREADABLE_COPY, props.status.unreadableReason ?? '') ?? {
      title: 'This token cannot be decrypted',
      description:
        'This deployment cannot open the stored token. Enter it again, or check the API log ' +
        'for the reason.',
    },
)

function save() {
  if (token.value.length === 0) return
  emit('save', token.value)
  // Cleared by the PAGE, through `clearDraft`, and only once the call landed:
  // throwing away a pasted credential on a refusal makes the operator fetch it
  // again.
}

/** Called by the page after a successful save. */
function clearDraft() {
  draft.value = ''
}

defineExpose({ clearDraft })
</script>

<template>
  <div>
    <div
      class="flex flex-col-reverse gap-2 mb-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
    >
      <p class="text-sm text-muted min-w-0">{{ description }}</p>
      <div class="sm:text-right sm:shrink-0">
        <UBadge :color="badge.color" variant="subtle">{{ badge.label }}</UBadge>
        <p v-if="status.subject" class="text-xs text-muted mt-1">{{ status.subject }}</p>
        <p v-else-if="status.hint" class="text-xs text-muted mt-1">ends in {{ status.hint }}</p>
      </div>
    </div>

    <UAlert
      v-if="status.state === 'unreadable'"
      class="mb-3"
      color="warning"
      variant="subtle"
      :title="unreadable.title"
      :description="unreadable.description"
    />

    <div class="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      <UInput
        v-model="draft"
        class="w-full sm:flex-1"
        type="password"
        autocomplete="off"
        :placeholder="placeholder ?? 'Paste a token'"
        @keyup.enter="save()"
      />
      <div class="flex items-center gap-2 sm:shrink-0">
        <UButton
          class="grow justify-center sm:grow-0"
          :loading="busy"
          :disabled="token.length === 0"
          @click="save()"
        >
          Save
        </UButton>
        <!--
          `error`, like Remove and Revoke. It destroys a credential nothing on
          this screen can read back, so it reads as what it is rather than as the
          neutral twin of Save it sits beside. The page asks before it runs.
        -->
        <UButton
          v-if="status.state !== 'absent'"
          variant="ghost"
          color="error"
          class="grow justify-center sm:grow-0"
          :loading="busy"
          @click="emit('clear')"
        >
          Clear
        </UButton>
      </div>
    </div>
  </div>
</template>
