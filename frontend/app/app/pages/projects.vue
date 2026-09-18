<script setup lang="ts">
import type { Project, VcsProvider } from '@sainte-beuve/contracts'
import { DEFAULT_PROJECT_SKILLS, VCS_PROVIDERS, vcsDisplayName } from '@sainte-beuve/contracts'
import { blankToNull, parseSkills } from '../utils/text'

// The repositories this workspace watches, and the skill vocabulary each one
// offers when somebody asks for attention on it.
//
// Registering a project needs no credential and makes no call to the host. That
// is deliberate: the workspace reports per project whether it could actually be
// read, so somebody setting a deployment up can add their repositories first
// and see exactly which connection is missing, rather than being sent to the
// Configuration screen with nothing to explain why.
const api = useSainteBeuveApi()
const { data, pending, error, refresh } = await useAsyncData('projects', () => api.listProjects())

const projects = computed<Project[]>(() => data.value?.projects ?? [])
const { busy, run } = useApiAction({ refresh })

const provider = ref<VcsProvider>('github')
const owner = ref('')
const repo = ref('')
const webUrl = ref('')

const providers = VCS_PROVIDERS.map((value) => ({ value, label: vcsDisplayName(value) }))

/** The skills being edited, per project, so a row can be changed without a modal. */
const drafts = ref<Record<string, string>>({})

function draftFor(project: Project): string {
  return drafts.value[project.id] ?? project.skills.join(', ')
}

async function add() {
  const added = await run(
    () =>
      api.addProject({
        provider: provider.value,
        owner: owner.value.trim(),
        repo: repo.value.trim(),
        webUrl: blankToNull(webUrl.value),
      }),
    'Could not register the project',
    'add',
  )
  // Only on success: clearing the form after a 409 throws away what was typed
  // right before the person has to correct one field of it.
  if (added) {
    owner.value = ''
    repo.value = ''
    webUrl.value = ''
  }
}

async function saveSkills(project: Project) {
  const saved = await run(
    () => api.updateProject(project.id, { skills: parseSkills(draftFor(project)) }),
    'Could not save the skills',
    project.id,
  )
  if (saved) delete drafts.value[project.id]
}

function remove(project: Project) {
  return run(() => api.removeProject(project.id), 'Could not remove the project', project.id)
}
</script>

<template>
  <UContainer class="py-6 sm:py-8">
    <div class="flex items-start justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Projects</h1>
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
        <h2 class="font-medium">Add a project</h2>
      </template>
      <div class="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <UFormField label="Host">
          <USelect v-model="provider" :items="providers" value-key="value" class="w-full sm:w-32" />
        </UFormField>
        <UFormField label="Owner" description="A GitHub org, or a GitLab namespace.">
          <UInput v-model="owner" class="w-full sm:w-auto" placeholder="kibertoad" />
        </UFormField>
        <UFormField label="Repository">
          <UInput v-model="repo" class="w-full sm:w-auto" placeholder="sainte-beuve" />
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
        <UButton
          class="justify-center"
          :disabled="owner.trim().length === 0 || repo.trim().length === 0"
          :loading="busy === 'add'"
          @click="add()"
        >
          Add
        </UButton>
      </div>
      <p class="text-xs text-muted mt-3">
        New projects start with {{ DEFAULT_PROJECT_SKILLS.join(' and ') }}. Change that below.
      </p>
    </UCard>

    <ApiErrorAlert v-if="error" :error="error" title="Could not read the projects" />

    <UCard v-else-if="projects.length === 0">
      <p class="text-sm text-muted">
        No projects yet. Your workspace has nothing to sweep until one is registered.
      </p>
    </UCard>

    <div v-else class="flex flex-col gap-3">
      <UCard v-for="project in projects" :key="project.id">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <UBadge variant="subtle" color="neutral">
                {{ vcsDisplayName(project.provider) }}
              </UBadge>
              <ULink v-if="project.webUrl" :to="project.webUrl" target="_blank" class="font-medium">
                {{ project.owner }}/{{ project.repo }}
              </ULink>
              <span v-else class="font-medium">{{ project.owner }}/{{ project.repo }}</span>
            </div>
            <div class="flex flex-col items-stretch gap-2 mt-3 sm:flex-row sm:items-end">
              <UFormField
                label="Skills an attention request can ask for"
                description="Comma separated. This is the list the ask picks from, so a team names its own areas here."
              >
                <UInput
                  :model-value="draftFor(project)"
                  class="w-full sm:w-96"
                  @update:model-value="drafts[project.id] = String($event)"
                />
              </UFormField>
              <UButton
                size="sm"
                variant="soft"
                class="justify-center"
                :loading="busy === project.id"
                @click="saveSkills(project)"
              >
                Save
              </UButton>
            </div>
          </div>
          <UButton
            size="sm"
            variant="ghost"
            color="error"
            icon="i-lucide-trash-2"
            class="self-start sm:shrink-0"
            :loading="busy === project.id"
            @click="remove(project)"
          >
            Remove
          </UButton>
        </div>
      </UCard>
    </div>
  </UContainer>
</template>
