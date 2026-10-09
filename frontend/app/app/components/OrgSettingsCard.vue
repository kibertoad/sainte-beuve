<script setup lang="ts">
import type { MergeComment, Org, OrgEnrolment, UpdateOrgInput } from '@sainte-beuve/contracts'

// The org this caller is in: its name, who may join it, and the repository
// owner its projects usually live under, and the merge comments every team and
// project starts from. An admin edits it; a member reads it.
const props = defineProps<{
  org: Org
  admin: boolean
  busy: boolean
}>()

const emit = defineEmits<{ save: [patch: UpdateOrgInput] }>()

const enrolments: { label: string; value: OrgEnrolment }[] = [
  { label: 'Invite only', value: 'invite' },
  { label: 'Anyone who can sign in', value: 'open' },
]

const name = ref(props.org.name)
const enrolment = ref<OrgEnrolment>(props.org.enrolment)
const owner = ref(props.org.defaultRepositoryOwner ?? '')
const mergeComments = ref<MergeComment[] | null>(props.org.mergeComments)

// The org is re-read after a save; the form follows it rather than what was typed.
watch(
  () => props.org,
  (org) => {
    name.value = org.name
    enrolment.value = org.enrolment
    owner.value = org.defaultRepositoryOwner ?? ''
    mergeComments.value = org.mergeComments
  },
)

function save() {
  const trimmed = owner.value.trim()
  emit('save', {
    name: name.value.trim(),
    enrolment: enrolment.value,
    defaultRepositoryOwner: trimmed.length === 0 ? null : trimmed,
    mergeComments: cleanMergeComments(mergeComments.value) ?? [],
  })
}
</script>

<template>
  <UCard>
    <div class="mb-4">
      <p class="font-medium">This organization</p>
      <p class="text-sm text-muted">
        Addressed as <code>{{ org.slug }}</code> when somebody signs in to it.
      </p>
    </div>

    <div class="flex flex-col gap-5 max-w-xl">
      <UFormField label="Name">
        <UInput v-model="name" class="w-full" :disabled="!admin" />
      </UFormField>
      <UFormField
        label="Who may join"
        description="Invite only admits accounts an admin added to the reviewer directory. Anyone who can sign in suits an OAuth client scoped to your own people."
      >
        <USelect
          v-model="enrolment"
          :items="enrolments"
          value-key="value"
          class="w-full sm:w-64"
          :disabled="!admin"
        />
      </UFormField>
      <UFormField
        label="Default repository owner"
        description="The GitHub org or GitLab namespace a new repository starts from on the Repositories screen."
      >
        <UInput v-model="owner" class="w-full" placeholder="acme" :disabled="!admin" />
      </UFormField>
      <UFormField
        label="Merge comments"
        description="Buttons on My PRs that post a comment for a merge bot, such as /merge for a merge queue. A team or a project can replace them."
      >
        <MergeCommentsEditor v-model="mergeComments" :disabled="!admin" />
      </UFormField>
      <div v-if="admin" class="flex justify-end">
        <UButton :disabled="name.trim().length === 0" :loading="busy" @click="save()">
          Save
        </UButton>
      </div>
      <p v-else class="text-sm text-muted">Only an admin can change these.</p>
    </div>
  </UCard>
</template>
