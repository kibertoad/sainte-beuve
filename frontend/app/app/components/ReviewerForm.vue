<script setup lang="ts">
import type { CreateReviewer, Reviewer } from '@sainte-beuve/contracts'
import { VCS_PROVIDERS, vcsDisplayName } from '@sainte-beuve/contracts'
import { draftFrom, toCreateReviewer } from '../utils/reviewerDraft'

// One form for adding somebody to the pool and for editing a row, because the
// fields are the same set and a second copy would drift the day a field is
// added. What it emits is a `CreateReviewer`; the page turns that into the patch
// the route takes, which is only the fields that moved.
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

// Seeded once, and never refilled from the prop.
//
// Each row renders its own instance, under a card keyed by reviewer id and behind
// a `v-if` on the row being edited, so this form is never handed a second person.
// A watch on `props.reviewer` would therefore only ever fire on a background
// refetch, where the reviewer is the same person as a new object, and it would
// throw away whatever was being typed at the time.
const draft = ref(draftFrom(props.reviewer))

const availabilities = [
  { value: 'available' as const, label: 'Available' },
  { value: 'paused' as const, label: 'Paused' },
]

const hosts = VCS_PROVIDERS.map((provider) => ({
  provider,
  label: `${vcsDisplayName(provider)} handle`,
}))

function submit() {
  emit('submit', toCreateReviewer(draft.value))
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
