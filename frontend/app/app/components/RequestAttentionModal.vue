<script setup lang="ts">
import type { OpenPullRequest, Project } from '@sainte-beuve/contracts'
import { MAX_NEEDED_COMMITMENTS } from '@sainte-beuve/contracts'
import { blankToNull } from '../utils/text'

// "Somebody please look at this."
//
// The skills offered are the PROJECT's, not a free-text box: a team that
// renames Backend to `payments` renames it once, on the project, and everybody
// asking about that repository picks from the same list. Typing a skill nobody
// holds is how an ask reaches nobody and looks like a bug.
//
// Ticking people in the ranked list names them, and then the ask goes to
// exactly those people; with nobody ticked it goes to everyone the skills and
// the team gate let in.
const props = defineProps<{
  pullRequest: OpenPullRequest | null
  projects: Project[]
  busy: boolean
}>()

const emit = defineEmits<{
  submit: [
    request: {
      recipientIds: string[]
      requiredSkills: string[]
      sameTeamOnly: boolean
      neededCommitments: number
      note: string | null
      keepAsking: boolean
    },
  ]
  close: []
}>()

const selectedSkills = ref<string[]>([])
const recipientIds = ref<string[]>([])
const sameTeamOnly = ref(false)
const neededCommitments = ref(1)
const note = ref('')
// On by default: somebody who picks reviewers wants the review covered, and a
// decline that leaves the ask short would otherwise stall it until they look.
const keepAsking = ref(true)

const open = computed({
  get: () => props.pullRequest !== null,
  set: (value: boolean) => {
    if (!value) emit('close')
  },
})

/**
 * The vocabulary of the project this pull request is in, when it is a known one.
 *
 * Matched on the HOST as well as the path: `platform/api` can be registered on
 * both, with a different vocabulary on each, and offering the other host's
 * skills is how a requester picks one nobody on this side holds and the ask
 * reaches nobody while looking correctly configured.
 */
const skills = computed(() => {
  const pr = props.pullRequest?.pullRequest
  if (pr === undefined) return []
  const project = props.projects.find(
    (entry) => entry.provider === pr.provider && entry.owner === pr.owner && entry.repo === pr.repo,
  )
  return project?.skills ?? []
})

const recommendations = useReviewerRecommendations(
  computed(() => props.pullRequest?.pullRequest ?? null),
  selectedSkills,
)

// Somebody ticked and then ranked out of the list by a new skill choice would
// be asked without being on screen, so a fresh ranking drops them.
watch(recommendations.result, (result) => {
  if (result === null) return
  const listed = new Set(result.recommendations.map((entry) => entry.reviewerId))
  recipientIds.value = recipientIds.value.filter((id) => listed.has(id))
})

const named = computed(() => recipientIds.value.length > 0)

/** A named ask cannot wait for more people than it names. */
const counts = computed(() => {
  const most = named.value
    ? Math.min(recipientIds.value.length, MAX_NEEDED_COMMITMENTS)
    : MAX_NEEDED_COMMITMENTS
  return Array.from({ length: most }, (_, index) => index + 1)
})

watch(counts, (available) => {
  neededCommitments.value = Math.min(neededCommitments.value, available.length)
})

const submitLabel = computed(() => {
  const count = recipientIds.value.length
  if (count === 0) return 'Ask everyone who matches'
  return count === 1 ? 'Ask 1 reviewer' : `Ask ${count} reviewers`
})

watch(
  () => props.pullRequest,
  () => {
    selectedSkills.value = []
    recipientIds.value = []
    sameTeamOnly.value = false
    neededCommitments.value = 1
    note.value = ''
    keepAsking.value = true
  },
)

function submit() {
  emit('submit', {
    recipientIds: recipientIds.value,
    requiredSkills: selectedSkills.value,
    sameTeamOnly: named.value ? false : sameTeamOnly.value,
    neededCommitments: neededCommitments.value,
    note: blankToNull(note.value),
    keepAsking: named.value && keepAsking.value,
  })
}
</script>

<template>
  <UModal v-model:open="open" title="Ask for attention">
    <template #body>
      <div v-if="pullRequest" class="flex flex-col gap-4">
        <p class="text-sm text-muted">
          {{ pullRequest.title }}
        </p>

        <UFormField
          label="Skills a reviewer needs"
          :description="
            skills.length === 0
              ? 'This repository has no skill vocabulary. Add one on the Repositories screen, or ask everybody available.'
              : named
                ? 'Ranks the matches below. The people you tick are asked whatever skills they hold.'
                : 'Everyone available who holds all of these will be asked, unless you tick people below. Pick none to ask everybody.'
          "
        >
          <div class="flex flex-wrap gap-2">
            <UCheckbox
              v-for="skill in skills"
              :key="skill"
              v-model="selectedSkills"
              :value="skill"
              :label="skill"
            />
          </div>
        </UFormField>

        <UFormField
          label="Best matches"
          description="Ranked on the skills picked above, or the repository's when none are, and on its domains. Open reviews lower a reviewer's rank. Tick people to ask only them."
        >
          <ReviewerRecommendations
            v-model:selected="recipientIds"
            :result="recommendations.result.value"
            :pending="recommendations.pending.value"
            :failure="recommendations.failure.value"
          />
        </UFormField>

        <UFormField
          label="Reviewers wanted"
          description="The ask resolves and disappears from everybody's inbox once this many people commit."
        >
          <USelect v-model="neededCommitments" :items="counts" class="w-full sm:w-24" />
        </UFormField>

        <UCheckbox
          v-if="named"
          v-model="keepAsking"
          label="If somebody declines, ask the next best match"
          description="Keeps the ask able to fill. Off, you are shown who declined and ask on yourself."
        />

        <UCheckbox
          v-if="!named"
          v-model="sameTeamOnly"
          label="Only my team"
          description="Keeps the ask inside your own team. Nobody without a team recorded is in it."
        />

        <UFormField label="Anything they should know" description="Optional.">
          <UTextarea v-model="note" :rows="2" class="w-full" />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton variant="ghost" color="neutral" @click="emit('close')">Cancel</UButton>
        <UButton :loading="busy" @click="submit()">{{ submitLabel }}</UButton>
      </div>
    </template>
  </UModal>
</template>
