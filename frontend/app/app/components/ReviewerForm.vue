<script setup lang="ts">
import type { CreateReviewer, Reviewer, VcsProvider } from '@sainte-beuve/contracts'
import { NO_VCS_HANDLES, VCS_PROVIDERS, vcsDisplayName, withHandle } from '@sainte-beuve/contracts'

// One form for adding somebody to the pool and for editing a row, because the
// fields are the same set and a second copy would drift the day a field is
// added. What it emits is a `CreateReviewer`, which is also a valid patch: every
// field on it is a field `updateReviewer` accepts.
//
// A handle PER HOST, never one login. The same engineer is `kibertoad` on one
// host and `igor.savin` on another, and a reviewer with no handle on the host a
// project lives on is invisible in that project's workspace. This screen is the
// only place that says so, which is why the inputs are one per host rather than
// a single box.
const props = defineProps<{
  /** The row being edited, or null when this is the "add somebody" form. */
  reviewer: Reviewer | null
  busy: boolean
  submitLabel: string
}>()

const emit = defineEmits<{
  submit: [draft: CreateReviewer]
  cancel: []
}>()

/**
 * The inputs, as text. Every nullable field is a string here and becomes a null
 * on the way out, because an empty box means "nothing recorded" rather than a
 * person whose team is the empty string.
 */
interface ReviewerDraft {
  displayName: string
  handles: Record<VcsProvider, string>
  slackUserId: string
  team: string
  skills: string
  availability: Reviewer['availability']
  weight: number
}

/** A FACTORY, not a shared constant: `v-model` writes straight into what it returns. */
function emptyDraft(): ReviewerDraft {
  return {
    displayName: '',
    handles: { github: '', gitlab: '' },
    slackUserId: '',
    team: '',
    skills: '',
    availability: 'available',
    weight: 1,
  }
}

function draftFrom(reviewer: Reviewer | null): ReviewerDraft {
  if (reviewer === null) return emptyDraft()
  return {
    displayName: reviewer.displayName,
    handles: { github: reviewer.handles.github ?? '', gitlab: reviewer.handles.gitlab ?? '' },
    slackUserId: reviewer.slackUserId ?? '',
    team: reviewer.team ?? '',
    skills: reviewer.skills.join(', '),
    availability: reviewer.availability,
    weight: reviewer.weight,
  }
}

const draft = ref<ReviewerDraft>(draftFrom(props.reviewer))

const availabilities = [
  { value: 'available' as const, label: 'Available' },
  { value: 'paused' as const, label: 'Paused' },
]

const hosts = VCS_PROVIDERS.map((provider) => ({
  provider,
  label: `${vcsDisplayName(provider)} handle`,
}))

// Refill when the form is reused for somebody else, so an edit never opens on
// the row that was open before it.
watch(
  () => props.reviewer,
  (reviewer) => {
    draft.value = draftFrom(reviewer)
  },
)

/** An empty box means "nothing recorded here", which is a null rather than a blank. */
function optional(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function submit() {
  emit('submit', {
    displayName: draft.value.displayName.trim(),
    handles: VCS_PROVIDERS.reduce(
      (built, provider) => withHandle(built, provider, optional(draft.value.handles[provider])),
      NO_VCS_HANDLES,
    ),
    slackUserId: optional(draft.value.slackUserId),
    team: optional(draft.value.team),
    skills: draft.value.skills
      .split(',')
      .map((skill) => skill.trim())
      .filter((skill) => skill.length > 0),
    availability: draft.value.availability,
    weight: draft.value.weight,
  })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-end gap-3">
      <UFormField label="Name">
        <UInput v-model="draft.displayName" placeholder="Ada Lovelace" />
      </UFormField>
      <UFormField
        v-for="host in hosts"
        :key="host.provider"
        :label="host.label"
        description="Optional. Without it, their pull requests on that host are invisible here."
      >
        <UInput v-model="draft.handles[host.provider]" placeholder="ada" />
      </UFormField>
      <UFormField label="Team" description="Optional. What an ask can be kept inside.">
        <UInput v-model="draft.team" placeholder="platform" />
      </UFormField>
      <UFormField label="Slack user id" description="Optional. Where a reminder is delivered.">
        <UInput v-model="draft.slackUserId" placeholder="U01ABCDEF" />
      </UFormField>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <UFormField
        label="Skills"
        description="Comma separated. A review needs ALL of the skills it asks for, so a partial match is never picked."
      >
        <UInput v-model="draft.skills" class="w-96" placeholder="typescript, payments" />
      </UFormField>
      <UFormField label="Availability" description="Paused keeps the row and its skills.">
        <USelect
          v-model="draft.availability"
          :items="availabilities"
          value-key="value"
          class="w-36"
        />
      </UFormField>
      <UFormField
        label="Weight"
        description="Share of the load. A 0.5 is picked about half as often as a 1."
      >
        <UInput
          v-model.number="draft.weight"
          type="number"
          min="0"
          max="10"
          step="0.1"
          class="w-24"
        />
      </UFormField>
    </div>

    <div class="flex justify-end gap-2">
      <UButton variant="ghost" color="neutral" @click="emit('cancel')">Cancel</UButton>
      <UButton :disabled="draft.displayName.trim().length === 0" :loading="busy" @click="submit()">
        {{ submitLabel }}
      </UButton>
    </div>
  </div>
</template>
