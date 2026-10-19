<script setup lang="ts">
import type { MyPullRequest, ReviewerSuggestions } from '@sainte-beuve/contracts'
import { formatPullRequestRef, MAX_ATTENTION_RECIPIENTS } from '@sainte-beuve/contracts'
import { blankToNull } from '../utils/text'

// Picking reviewers for your own pull request. The best matches come ranked
// with the top ones ticked; anybody else in the directory can be added by
// name. The people picked are asked to commit, and hear of it as any named ask.
const props = defineProps<{
  pullRequest: MyPullRequest | null
  busy: boolean
}>()

const emit = defineEmits<{
  submit: [request: { reviewerIds: string[]; note: string | null }]
  close: []
}>()

const api = useSainteBeuveApi()

const suggestions = ref<ReviewerSuggestions | null>(null)
const failure = ref<unknown>(null)
const ticked = ref<string[]>([])
const added = ref<string[]>([])
const note = ref('')

const open = computed({
  get: () => props.pullRequest !== null,
  set: (value: boolean) => {
    if (!value) emit('close')
  },
})

watch(
  () => props.pullRequest,
  async (pr) => {
    suggestions.value = null
    failure.value = null
    ticked.value = []
    added.value = []
    note.value = ''
    if (pr === null) return
    try {
      const read = await api.suggestReviewers({
        pullRequest: pr.pullRequest,
        requestedReviewerLogins: [...pr.requestedReviewerLogins],
      })
      // A dialog closed or reopened on another pull request meanwhile keeps its own answer.
      if (props.pullRequest !== pr) return
      suggestions.value = read
      ticked.value = [...read.preselectedIds]
    } catch (err) {
      if (props.pullRequest === pr) failure.value = err
    }
  },
  { immediate: true },
)

const searchable = computed(() =>
  suggestions.value === null ? [] : searchableReviewers(suggestions.value),
)
const picked = computed(() => reviewersToAsk(ticked.value, added.value))
const tooMany = computed(() => picked.value.length > MAX_ATTENTION_RECIPIENTS)

function submit() {
  emit('submit', { reviewerIds: picked.value, note: blankToNull(note.value) })
}
</script>

<template>
  <UModal v-model:open="open" title="Suggest reviewers">
    <template #body>
      <div v-if="pullRequest" class="flex flex-col gap-4">
        <div>
          <p class="text-sm">{{ pullRequest.title }}</p>
          <p class="text-xs text-muted">{{ formatPullRequestRef(pullRequest.pullRequest) }}</p>
        </div>

        <ApiErrorAlert v-if="failure" :error="failure" title="Could not rank reviewers" />
        <LoadingSpinner v-else-if="suggestions === null" label="Ranking reviewers…" />

        <template v-else>
          <UFormField
            label="Best matches"
            description="Ranked on the repository's skills and domains, past reviews here, then fewer open reviews. The top ones are ticked for you."
          >
            <ReviewerRecommendations
              v-model:selected="ticked"
              :result="suggestions"
              :pending="false"
              :failure="null"
              :same-team-only="false"
              :can-show-more="false"
            />
          </UFormField>

          <UFormField
            v-if="searchable.length > 0"
            label="Anybody else"
            description="Search the directory to ask somebody the ranking left out."
          >
            <UInputMenu
              v-model="added"
              multiple
              :items="searchable"
              value-key="value"
              placeholder="Search by name"
              class="w-full"
            />
          </UFormField>

          <UFormField v-if="suggestions.involved.length > 0" label="Already on it">
            <ul class="flex flex-col gap-1">
              <li
                v-for="person in suggestions.involved"
                :key="person.reviewerId"
                class="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  {{ person.displayName }}
                  <span v-if="person.team" class="text-muted">· {{ person.team }}</span>
                </span>
                <UBadge
                  variant="subtle"
                  size="sm"
                  :color="person.state === 'declined' ? 'neutral' : 'success'"
                >
                  {{ involvementLabel(person.state) }}
                </UBadge>
              </li>
            </ul>
          </UFormField>

          <UFormField label="Anything they should know" description="Optional.">
            <UTextarea v-model="note" :rows="2" class="w-full" />
          </UFormField>

          <p v-if="tooMany" class="text-sm text-error">
            One ask can name at most {{ MAX_ATTENTION_RECIPIENTS }} people.
          </p>
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex flex-col gap-2 w-full sm:flex-row sm:items-center sm:justify-between">
        <p class="text-xs text-muted">
          Each person is notified and asked to commit to reviewing it.
        </p>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="emit('close')">Cancel</UButton>
          <UButton
            :loading="busy"
            :disabled="picked.length === 0 || tooMany || suggestions === null"
            @click="submit()"
          >
            {{ askLabel(picked.length) }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
