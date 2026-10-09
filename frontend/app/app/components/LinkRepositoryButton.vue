<script setup lang="ts">
import type { PullRequestRef } from '@sainte-beuve/contracts'

// The one-click registration offered beside a pull request in a repository
// nobody linked. Registering is an admin's write, so a member is told whom to ask.
const props = defineProps<{ pullRequest: PullRequestRef }>()
const emit = defineEmits<{ linked: [] }>()

const api = useSainteBeuveApi()
const auth = useAuthState()
const toast = useToast()
const { busy, run } = useApiAction()

const repository = computed(() => `${props.pullRequest.owner}/${props.pullRequest.repo}`)

async function link() {
  const { provider, owner, repo } = props.pullRequest
  const linked = await run(
    () => api.addProject({ provider, owner, repo }),
    `Could not link ${repository.value}`,
    'link',
  )
  if (!linked) return
  toast.add({ color: 'success', title: `Linked ${repository.value}` })
  emit('linked')
}
</script>

<template>
  <UButton
    v-if="auth.isAdmin.value"
    size="sm"
    variant="soft"
    icon="i-lucide-link"
    :loading="busy === 'link'"
    @click="link"
  >
    Link {{ repository }}
  </UButton>
  <span v-else class="text-xs text-muted">Ask an admin to link {{ repository }}.</span>
</template>
