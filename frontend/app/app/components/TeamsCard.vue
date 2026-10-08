<script setup lang="ts">
import type { MergeComment, Reviewer, Team } from '@sainte-beuve/contracts'

// The org's teams. Anybody may create one they own; its owner or an admin may
// rename it, hand it to somebody else or delete it. The API decides, and this
// card only hides what the caller would be refused.
const props = defineProps<{
  teams: Team[]
  reviewers: Reviewer[]
  /** The caller's reviewer id, or null when the caller is not a person. */
  viewerId: string | null
  admin: boolean
  busy: string | null
}>()

const emit = defineEmits<{
  create: [team: { name: string; ownerId?: string | null }]
  save: [
    team: Team,
    patch: { name: string; ownerId: string | null; mergeComments: MergeComment[] | null },
  ]
  remove: [team: Team]
}>()

/** USelect cannot hold null or an empty string, so "nobody" travels as this. */
const NOBODY = '__nobody__'

function ownerIdOf(value: string): string | null {
  return value === NOBODY ? null : value
}

const ownerOptions = computed(() => [
  { label: 'Nobody (admins manage it)', value: NOBODY },
  ...props.reviewers.map((reviewer) => ({ label: reviewer.displayName, value: reviewer.id })),
])

function ownerName(team: Team): string {
  if (team.ownerId === null) return 'No owner'
  const owner = props.reviewers.find((reviewer) => reviewer.id === team.ownerId)
  return owner === undefined ? 'Unknown owner' : `Owned by ${owner.displayName}`
}

function mergeCommentsNote(team: Team): string | null {
  if (team.mergeComments === null) return null
  const count = team.mergeComments.length
  return count === 0
    ? 'No merge comments'
    : `${count} merge comment${count === 1 ? '' : 's'} of its own`
}

function canManage(team: Team): boolean {
  return props.admin || (team.ownerId !== null && team.ownerId === props.viewerId)
}

/** A team needs an owner to belong to, unless an admin creates it for nobody. */
const canCreate = computed(() => props.admin || props.viewerId !== null)

/** Leaves the owner out of the request, so the API makes whoever creates the team its owner. */
const YOU = '__you__'

const newOwnerOptions = computed(() => [{ label: 'You', value: YOU }, ...ownerOptions.value])

const newName = ref('')
const newOwner = ref(YOU)

function create() {
  const name = newName.value.trim()
  if (name.length === 0) return
  const named = props.admin && newOwner.value !== YOU
  emit('create', named ? { name, ownerId: ownerIdOf(newOwner.value) } : { name })
}

/** Called by the page once a create has landed, so a refusal keeps what was typed. */
function clearDraft() {
  newName.value = ''
}

defineExpose({ clearDraft })

const editing = ref<string | null>(null)
const draftName = ref('')
const draftOwner = ref(NOBODY)
const draftMergeComments = ref<MergeComment[] | null>(null)

function edit(team: Team) {
  editing.value = team.id
  draftName.value = team.name
  draftOwner.value = team.ownerId ?? NOBODY
  draftMergeComments.value = team.mergeComments
}

function save(team: Team) {
  emit('save', team, {
    name: draftName.value.trim(),
    ownerId: ownerIdOf(draftOwner.value),
    mergeComments: cleanMergeComments(draftMergeComments.value),
  })
  editing.value = null
}
</script>

<template>
  <UCard>
    <div class="mb-4">
      <p class="font-medium">Teams</p>
      <p class="text-sm text-muted">
        What a reviewer's team is picked from, and what keeps an attention request inside one team.
        Anybody may create a team they own; the owner or an admin may rename it, hand it to somebody
        else, or delete it.
      </p>
    </div>

    <ul v-if="teams.length > 0" class="flex flex-col divide-y divide-default mb-4">
      <li v-for="team in teams" :key="team.id" class="py-3">
        <div v-if="editing === team.id" class="flex flex-col gap-3">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
            <UFormField label="Name" class="sm:flex-1">
              <UInput v-model="draftName" class="w-full" />
            </UFormField>
            <UFormField label="Owner" class="sm:w-64">
              <USelect
                v-model="draftOwner"
                :items="ownerOptions"
                value-key="value"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField
            label="Merge comments"
            description="Offered on My PRs for pull requests by this team's members, unless the project has its own."
          >
            <MergeCommentsEditor v-model="draftMergeComments" inherit-from="the organization's" />
          </UFormField>
          <div class="flex gap-2 justify-end">
            <UButton variant="ghost" color="neutral" @click="editing = null">Cancel</UButton>
            <UButton
              :disabled="draftName.trim().length === 0"
              :loading="busy === team.id"
              @click="save(team)"
            >
              Save
            </UButton>
          </div>
        </div>
        <div v-else class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <p class="font-medium truncate">{{ team.name }}</p>
            <p class="text-sm text-muted">
              {{ ownerName(team) }}
              <template v-if="mergeCommentsNote(team)">
                &middot; {{ mergeCommentsNote(team) }}</template
              >
            </p>
          </div>
          <div v-if="canManage(team)" class="flex gap-2">
            <UButton icon="i-lucide-pencil" variant="ghost" @click="edit(team)">Edit</UButton>
            <UButton
              icon="i-lucide-trash-2"
              variant="ghost"
              color="error"
              :loading="busy === team.id"
              :aria-label="`Delete ${team.name}`"
              @click="emit('remove', team)"
            />
          </div>
        </div>
      </li>
    </ul>
    <p v-else class="text-sm text-muted mb-4">No teams yet.</p>

    <div v-if="canCreate" class="flex flex-col gap-3 sm:flex-row sm:items-end">
      <UFormField label="New team" class="sm:flex-1">
        <UInput v-model="newName" class="w-full" placeholder="Platform" @keydown.enter="create()" />
      </UFormField>
      <UFormField v-if="admin" label="Owner" class="sm:w-64">
        <USelect v-model="newOwner" :items="newOwnerOptions" value-key="value" class="w-full" />
      </UFormField>
      <UButton
        icon="i-lucide-plus"
        class="self-end"
        :disabled="newName.trim().length === 0"
        :loading="busy === 'create-team'"
        @click="create()"
      >
        Create
      </UButton>
    </div>
  </UCard>
</template>
