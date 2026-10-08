<script setup lang="ts">
import type { Reviewer } from '@sainte-beuve/contracts'

// Development mode's persona switch. Rendered only when the deployment runs with
// DEV_MODE=true, so a PR author and a reviewer can be played from one GitHub
// account: every call to GitHub still goes through the deployment's token, and
// only the person the screens render for changes.

/** The option that drops the persona session, back to whoever the token acts as. */
const TOKEN_ACCOUNT = '__token__'

const api = useSainteBeuveApi()
const auth = useAuthState()
const { busy, run } = useApiAction()

const reviewers = ref<Reviewer[]>([])
const newName = ref('')

async function loadReviewers(): Promise<void> {
  await run(async () => {
    reviewers.value = (await api.listReviewers()).reviewers
  }, 'Could not list the people to act as')
}
onMounted(loadReviewers)

const current = computed(() => auth.viewer.value?.reviewer.id ?? TOKEN_ACCOUNT)

const items = computed(() => [
  // On an `open` deployment, signing out renders for the token's own person. On a
  // `required` one it signs out, which is what the label says.
  {
    label: auth.state.value?.mode === 'open' ? 'Your token’s account' : 'Sign out',
    value: TOKEN_ACCOUNT,
  },
  ...reviewers.value
    .filter((reviewer) => reviewer.availability !== 'paused')
    .map((reviewer) => ({ label: reviewer.displayName, value: reviewer.id })),
])

/** Every screen holds data read for the previous person, so the page starts over. */
async function switchTo(reviewerId: string): Promise<void> {
  if (reviewerId === current.value) return
  const switched = await run(
    () => (reviewerId === TOKEN_ACCOUNT ? api.signOut() : api.actAs(reviewerId)),
    'Could not switch person',
    'switch',
  )
  if (switched) reloadNuxtApp({ force: true })
}

async function createPersona(): Promise<void> {
  const displayName = newName.value.trim()
  if (displayName.length === 0) return
  const held: { created?: Reviewer } = {}
  await run(
    async () => {
      held.created = await api.createReviewer({ displayName })
    },
    'Could not add the persona',
    'create',
  )
  if (held.created === undefined) return
  newName.value = ''
  await switchTo(held.created.id)
}
</script>

<template>
  <div class="flex flex-col gap-2 rounded-md border border-dashed border-warning p-2">
    <p class="flex items-center gap-2 text-xs font-medium text-warning">
      <UIcon name="i-lucide-flask-conical" />
      Dev mode: acting as
    </p>
    <USelect
      :model-value="current"
      :items="items"
      value-key="value"
      class="w-full"
      :loading="busy === 'switch'"
      @update:model-value="switchTo($event as string)"
    />
    <div class="flex items-center gap-2">
      <UInput
        v-model="newName"
        size="sm"
        class="w-full"
        placeholder="New persona"
        @keyup.enter="createPersona()"
      />
      <UButton
        size="sm"
        icon="i-lucide-user-plus"
        aria-label="Add the persona and act as it"
        :disabled="newName.trim().length === 0"
        :loading="busy === 'create'"
        @click="createPersona()"
      />
    </div>
  </div>
</template>
