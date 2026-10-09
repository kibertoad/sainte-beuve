<script setup lang="ts">
import type { Project, UpdateProject, VcsProvider } from '@sainte-beuve/contracts'
import { DEFAULT_PROJECT_SKILLS, VCS_PROVIDERS, vcsDisplayName } from '@sainte-beuve/contracts'
import { blankToNull } from '../utils/text'

// The repositories this workspace watches, and the skill vocabulary each one
// offers when somebody asks for attention on it.
//
// Registering a repository needs no credential and makes no call to the host.
// That is deliberate: the workspace reports per repository whether it could
// actually be read, so somebody setting a deployment up can add their
// repositories first and see exactly which connection is missing, rather than
// being sent to the Configuration screen with nothing to explain why. The
// repository field's lookup is a suggestion only, and Add never waits on it.

// The screen's earlier address, so a bookmark still lands here.
definePageMeta({ alias: '/projects' })

const api = useSainteBeuveApi()
// LAZY, and not awaited: a page that awaits its read at setup holds the previous
// screen on screen until the whole list is down, validated and mounted, so a
// click on this destination looks like nothing happened. Rendered immediately
// instead, the skeleton below says what is coming. `AiReviewPanel` has done this
// since it was written, for the same reason.
const { data, pending, error, refresh } = useAsyncData('projects', () => api.listProjects(), {
  lazy: true,
})

const projects = computed<Project[]>(() => data.value?.projects ?? [])
const { busy, run } = useApiAction({ refresh })
const { confirm } = useConfirm()
const toast = useToast()

/** Said after a save lands, because the row itself looks the same before and after. */
function saved(title: string, project: { owner: string; repo: string }) {
  toast.add({ color: 'success', title, description: `${project.owner}/${project.repo}` })
}

const auth = useAuthState()
const defaultOwner = computed(() => auth.org.value?.defaultRepositoryOwner ?? '')

const provider = ref<VcsProvider>('github')
const owner = ref(defaultOwner.value)
// The org's default can land after this screen does; it fills an owner nobody has typed over.
watch(defaultOwner, (next, previous) => {
  if (owner.value === previous) owner.value = next
})
const repo = ref('')
const webUrl = ref('')
const skills = ref<string[]>([...DEFAULT_PROJECT_SKILLS])
const domains = ref<string[]>([])

const providers = VCS_PROVIDERS.map((value) => ({ value, label: vcsDisplayName(value) }))

const { skills: knownSkills, domains: knownDomains } = useKnownVocabulary({
  skills: () => projects.value.flatMap((project) => project.skills),
  domains: () => projects.value.flatMap((project) => project.domains),
})

async function add() {
  const added = await run(
    () =>
      api.addProject({
        provider: provider.value,
        owner: owner.value.trim(),
        repo: repo.value.trim(),
        webUrl: blankToNull(webUrl.value),
        skills: skills.value,
        domains: domains.value,
      }),
    'Could not register the repository',
    'add',
  )
  // Only on success: clearing the form after a 409 throws away what was typed
  // right before the person has to correct one field of it.
  if (added) {
    saved('Repository registered', { owner: owner.value.trim(), repo: repo.value.trim() })
    owner.value = defaultOwner.value
    repo.value = ''
    webUrl.value = ''
    skills.value = [...DEFAULT_PROJECT_SKILLS]
    domains.value = []
  }
}

async function saveVocabulary(project: Project, patch: UpdateProject) {
  const ok = await run(
    () => api.updateProject(project.id, patch),
    'Could not save the skills and domains',
    project.id,
  )
  if (ok) saved('Skills and domains saved', project)
}

async function saveMerging(project: Project, patch: UpdateProject) {
  const ok = await run(
    () => api.updateProject(project.id, patch),
    'Could not save the merge settings',
    `${project.id}:merging`,
  )
  if (ok) saved('Merge settings saved', project)
}

/**
 * Unregister a repository, once somebody has said so twice.
 *
 * It sat in the same row as Save, on one click, and took the skill vocabulary
 * and the workspace sweep with it. There is no undo and nothing on the host
 * changes, so the only place to catch a misclick is before it.
 *
 * Keyed `<id>:remove` rather than on the id, so pressing Remove does not put a
 * spinner on Save as well.
 */
async function remove(project: Project) {
  const confirmed = await confirm({
    title: `Stop watching ${project.owner}/${project.repo}?`,
    description:
      'Its skills are forgotten, it leaves the workspace sweep, and attention requests can no ' +
      'longer be raised on it. Nothing changes on the host, and you can register it again.',
    confirmLabel: 'Remove the repository',
  })
  if (!confirmed) return
  await run(
    () => api.removeProject(project.id),
    'Could not remove the repository',
    `${project.id}:remove`,
  )
}
</script>

<template>
  <UContainer class="py-6 sm:py-8">
    <div class="flex items-start justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Repositories</h1>
        <p class="text-sm text-muted">
          The repositories your workspace sweeps, and what a reviewer can be asked for on each.
        </p>
      </div>
      <UButton
        icon="i-lucide-refresh-cw"
        variant="ghost"
        class="shrink-0"
        :loading="pending"
        @click="refresh()"
      >
        Refresh
      </UButton>
    </div>

    <UCard class="mb-4">
      <template #header>
        <h2 class="font-medium">Add a repository</h2>
      </template>
      <div class="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <UFormField label="Host">
          <USelect v-model="provider" :items="providers" value-key="value" class="w-full sm:w-32" />
        </UFormField>
        <UFormField label="Owner" description="A GitHub org, or a GitLab namespace.">
          <UInput v-model="owner" class="w-full sm:w-auto" placeholder="kibertoad" />
        </UFormField>
        <UFormField label="Repository">
          <RepositoryNameInput v-model="repo" :provider="provider" :owner="owner" />
        </UFormField>
        <UFormField
          label="Page"
          description="Optional. A self-hosted install has no guessable URL."
        >
          <UInput
            v-model="webUrl"
            class="w-full sm:w-auto"
            placeholder="https://gitlab.example.com/platform/api"
          />
        </UFormField>
      </div>
      <MatchingFields
        v-model:skills="skills"
        v-model:domains="domains"
        class="mt-4"
        :known-skills="knownSkills"
        :known-domains="knownDomains"
      />
      <div class="mt-4">
        <UButton
          class="w-full justify-center sm:w-auto"
          :disabled="owner.trim().length === 0 || repo.trim().length === 0"
          :loading="busy === 'add'"
          @click="add()"
        >
          Add repository
        </UButton>
      </div>
    </UCard>

    <LoadingSpinner v-if="pending && data !== undefined" label="Updating…" class="mb-3" />

    <ApiErrorAlert v-if="error" :error="error" title="Could not read the repositories" />

    <LoadingCard v-else-if="data === undefined" />

    <UCard v-else-if="projects.length === 0">
      <p class="text-sm text-muted">
        No repositories yet. Your workspace has nothing to sweep until one is registered.
      </p>
    </UCard>

    <div v-else class="flex flex-col gap-3">
      <UCard v-for="project in projects" :key="project.id">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div class="min-w-0 sm:flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge variant="subtle" color="neutral">
                {{ vcsDisplayName(project.provider) }}
              </UBadge>
              <ULink
                v-if="safeHref(project.webUrl)"
                :to="safeHref(project.webUrl)"
                target="_blank"
                class="font-medium"
              >
                {{ project.owner }}/{{ project.repo }}
              </ULink>
              <span v-else class="font-medium">{{ project.owner }}/{{ project.repo }}</span>
            </div>
            <ProjectVocabulary
              class="mt-3"
              :project="project"
              :known-skills="knownSkills"
              :known-domains="knownDomains"
              :busy="busy === project.id"
              @save="saveVocabulary(project, $event)"
            />
            <ProjectMergeSettings
              class="mt-3"
              :project="project"
              :busy="busy === `${project.id}:merging`"
              @save="saveMerging(project, $event)"
            />
          </div>
          <UButton
            size="sm"
            variant="ghost"
            color="error"
            icon="i-lucide-trash-2"
            class="self-start sm:shrink-0"
            :loading="busy === `${project.id}:remove`"
            @click="remove(project)"
          >
            Remove
          </UButton>
        </div>
      </UCard>
    </div>
  </UContainer>
</template>
