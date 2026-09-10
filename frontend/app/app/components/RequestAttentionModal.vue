<script setup lang="ts">
import type { OpenPullRequest, Project } from '@sainte-beuve/contracts'
import { MAX_NEEDED_COMMITMENTS } from '@sainte-beuve/contracts'

// "Somebody please look at this."
//
// The skills offered are the PROJECT's, not a free-text box: a team that
// renames Backend to `payments` renames it once, on the project, and everybody
// asking about that repository picks from the same list. Typing a skill nobody
// holds is how an ask reaches nobody and looks like a bug.
const props = defineProps<{
  pullRequest: OpenPullRequest | null
  projects: Project[]
  busy: boolean
}>()

const emit = defineEmits<{
  submit: [
    request: {
      requiredSkills: string[]
      sameTeamOnly: boolean
      neededCommitments: number
      note: string | null
    },
  ]
  close: []
}>()

const selectedSkills = ref<string[]>([])
const sameTeamOnly = ref(false)
const neededCommitments = ref(1)
const note = ref('')

const open = computed({
  get: () => props.pullRequest !== null,
  set: (value: boolean) => {
    if (!value) emit('close')
  },
})

/** The vocabulary of the project this pull request is in, when it is a known one. */
const skills = computed(() => {
  const pr = props.pullRequest?.pullRequest
  if (pr === undefined) return []
  const project = props.projects.find((entry) => entry.owner === pr.owner && entry.repo === pr.repo)
  return project?.skills ?? []
})

const counts = Array.from({ length: MAX_NEEDED_COMMITMENTS }, (_, index) => index + 1)

watch(
  () => props.pullRequest,
  () => {
    selectedSkills.value = []
    sameTeamOnly.value = false
    neededCommitments.value = 1
    note.value = ''
  },
)

function submit() {
  emit('submit', {
    requiredSkills: selectedSkills.value,
    sameTeamOnly: sameTeamOnly.value,
    neededCommitments: neededCommitments.value,
    note: note.value.trim().length === 0 ? null : note.value.trim(),
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
              ? 'This project has no skill vocabulary. Add one on the Projects screen, or ask everybody available.'
              : 'Everyone available who holds all of these will be asked. Pick none to ask everybody.'
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
          label="Reviewers wanted"
          description="The ask resolves and disappears from everybody's inbox once this many people commit."
        >
          <USelect v-model="neededCommitments" :items="counts" class="w-24" />
        </UFormField>

        <UCheckbox
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
        <UButton :loading="busy" @click="submit()">Ask</UButton>
      </div>
    </template>
  </UModal>
</template>
