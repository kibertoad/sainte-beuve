<script setup lang="ts">
import type { VcsProvider } from '@sainte-beuve/contracts'
import { REPOSITORY_LOOKUP_MIN_QUERY, vcsDisplayName } from '@sainte-beuve/contracts'

// The repository field of the Add form: free text, with the owner's matching
// repositories offered in a dropdown once there is enough to look up. Free text
// because a repository the credential cannot see is still one somebody may
// register, and the dropdown is only ever a suggestion.
const props = defineProps<{ provider: VcsProvider; owner: string }>()
const repo = defineModel<string>({ required: true })

const auth = useAuthState()
const { result, pending, failure } = useRepositoryLookup({
  provider: toRef(props, 'provider'),
  owner: toRef(props, 'owner'),
  repo,
  enabled: auth.isAdmin,
})

const items = computed(() =>
  (result.value?.repositories ?? []).map((candidate) => ({
    label: candidate.repo,
    value: candidate.repo,
    description: candidate.description ?? undefined,
    icon: candidate.private ? 'i-lucide-lock' : 'i-lucide-book-marked',
  })),
)

/** What the open dropdown says when it has nothing to offer. */
const emptyMessage = computed(() => {
  const owner = props.owner.trim()
  if (failure.value !== null) return failure.value
  if (result.value?.ownerFound === false) {
    return `${vcsDisplayName(props.provider)} has no owner named ${owner}.`
  }
  if (result.value !== null) return `No repository under ${owner} matches "${repo.value.trim()}".`
  if (pending.value) return `Looking up repositories under ${owner}…`
  if (owner === '') return 'Set an owner to look up its repositories.'
  return `Type ${REPOSITORY_LOOKUP_MIN_QUERY} characters to look up repositories under ${owner}.`
})
</script>

<template>
  <UInputMenu
    v-if="auth.isAdmin.value"
    v-model="repo"
    mode="autocomplete"
    :items="items"
    value-key="value"
    ignore-filter
    :loading="pending"
    class="w-full sm:w-64"
    placeholder="sainte-beuve"
  >
    <template #empty>
      <span class="text-sm text-muted">{{ emptyMessage }}</span>
    </template>
  </UInputMenu>
  <UInput v-else v-model="repo" class="w-full sm:w-auto" placeholder="sainte-beuve" />
</template>
