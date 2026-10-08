<script setup lang="ts">
import type { Team, UpdateOrgInput } from '@sainte-beuve/contracts'
import { callerIsAdmin } from '../../composables/useIntegrationSettings'

// The org: its settings, its teams, and (for an admin) the other orgs on this
// deployment. Unlike the integration screens, every member uses this one: the
// team list is theirs too.
const api = useSainteBeuveApi()
const auth = useAuthState()
const { confirm } = useConfirm()

const { data, pending, error, refresh } = useAsyncData(
  'organization',
  async () => {
    const admin = await callerIsAdmin(auth)
    const [teams, reviewers, orgs] = await Promise.all([
      api.listTeams(),
      api.listReviewers(),
      admin ? api.listOrgs() : Promise.resolve(null),
    ])
    return { teams: teams.teams, reviewers: reviewers.reviewers, orgs: orgs?.orgs ?? null }
  },
  { lazy: true },
)

const { busy, run } = useApiAction({ refresh })

const viewerId = computed(() => auth.viewer.value?.reviewer.id ?? null)

const teamsCard = ref<{ clearDraft: () => void } | null>(null)
const orgsCard = ref<{ clearDraft: () => void } | null>(null)

async function saveOrg(patch: UpdateOrgInput) {
  const saved = await run(() => api.updateOrg(patch), 'Could not save the organization', 'org')
  // The org rides on the auth state, which the Projects screen reads its default from.
  if (saved) {
    auth.invalidate()
    await auth.refresh()
  }
}

async function createTeam(team: { name: string; ownerId?: string | null }) {
  const created = await run(
    () => api.createTeam(team.name, team.ownerId),
    'Could not create the team',
    'create-team',
  )
  if (created) teamsCard.value?.clearDraft()
}

async function saveTeam(team: Team, patch: { name: string; ownerId: string | null }) {
  const changes: { name?: string; ownerId?: string | null } = {}
  if (patch.name !== team.name) changes.name = patch.name
  if (patch.ownerId !== team.ownerId) changes.ownerId = patch.ownerId
  if (Object.keys(changes).length === 0) return
  await run(() => api.updateTeam(team.id, changes), 'Could not save the team', team.id)
}

async function removeTeam(team: Team) {
  const confirmed = await confirm({
    title: `Delete ${team.name}?`,
    description:
      'Everybody in it is left without a team. Attention requests already sent keep the name.',
    confirmLabel: 'Delete the team',
  })
  if (!confirmed) return
  await run(() => api.deleteTeam(team.id), 'Could not delete the team', team.id)
}

async function createOrg(org: Parameters<typeof api.createOrg>[0]) {
  const created = await run(() => api.createOrg(org), 'Could not create the organization', 'orgs')
  if (created) orgsCard.value?.clearDraft()
}
</script>

<template>
  <UContainer class="py-6 sm:py-8">
    <UButton
      to="/configuration"
      icon="i-lucide-arrow-left"
      variant="link"
      color="neutral"
      class="mb-4 px-0"
    >
      Configuration
    </UButton>

    <div class="flex flex-wrap items-start justify-between gap-3 mb-8">
      <div>
        <h1 class="text-2xl font-semibold">Organization</h1>
        <p class="text-sm text-muted">Its settings, its teams, and the other organizations here.</p>
      </div>
      <UButton icon="i-lucide-refresh-cw" variant="ghost" :loading="pending" @click="refresh()">
        Refresh
      </UButton>
    </div>

    <ApiErrorAlert v-if="error" :error="error" title="Could not read the organization" />

    <LoadingCard v-else-if="pending && !data" />

    <div v-else-if="data" class="flex flex-col gap-4">
      <OrgSettingsCard
        v-if="auth.org.value"
        :org="auth.org.value"
        :admin="auth.isAdmin.value"
        :busy="busy === 'org'"
        @save="saveOrg($event)"
      />
      <TeamsCard
        ref="teamsCard"
        :teams="data.teams"
        :reviewers="data.reviewers"
        :viewer-id="viewerId"
        :admin="auth.isAdmin.value"
        :busy="busy"
        @create="createTeam($event)"
        @save="saveTeam"
        @remove="removeTeam($event)"
      />
      <OrgListCard
        v-if="data.orgs && auth.org.value"
        ref="orgsCard"
        :orgs="data.orgs"
        :current-org-id="auth.org.value.id"
        :busy="busy === 'orgs'"
        @create="createOrg($event)"
      />
    </div>
  </UContainer>
</template>
