<script setup lang="ts">
import type { RepositoryReport } from '@sainte-beuve/contracts'
import { REVIEW_MILESTONES } from '@sainte-beuve/contracts'

// Every repository in an org-wide report with its medians. A row stacks below
// `sm`; picking a repository narrows the report to it.
defineProps<{ repositories: RepositoryReport[]; hotspotKeys: Set<string> }>()
const emit = defineEmits<{ select: [projectId: string] }>()
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-semibold">Repositories</h2>
      <p class="text-sm text-muted">Median per milestone. Highlighted cells are hotspots.</p>
    </template>
    <p v-if="repositories.length === 0" class="text-sm text-muted">No repository could be read.</p>
    <ul v-else class="divide-y divide-default">
      <li
        v-for="repository in repositories"
        :key="repository.projectId"
        class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
      >
        <div class="w-full min-w-0 sm:w-64 sm:shrink-0">
          <UButton
            variant="link"
            class="p-0 max-w-full truncate"
            @click="emit('select', repository.projectId)"
          >
            {{ repositoryName(repository) }}
          </UButton>
          <p class="text-xs text-muted">{{ repository.pullRequests }} pull requests</p>
        </div>
        <dl class="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
          <div
            v-for="milestone in REVIEW_MILESTONES"
            :key="milestone"
            class="rounded px-2 py-1"
            :class="
              hotspotKeys.has(`${repository.projectId}:${milestone}`)
                ? 'bg-warning/10 text-warning'
                : ''
            "
          >
            <dt class="text-xs text-muted">{{ MILESTONE_LABELS[milestone] }}</dt>
            <dd class="tabular-nums">
              {{ formatDuration(repository.metrics[milestone].medianMs) }}
              <span v-if="repository.metrics[milestone].waiting > 0" class="text-xs text-muted">
                ({{ repository.metrics[milestone].waiting }} waiting)
              </span>
            </dd>
          </div>
        </dl>
      </li>
    </ul>
  </UCard>
</template>
