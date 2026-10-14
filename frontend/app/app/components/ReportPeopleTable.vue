<script setup lang="ts">
import type { PersonReport } from '@sainte-beuve/contracts'
import { vcsDisplayName } from '@sainte-beuve/contracts'

// Who reviewed how much, and how quickly the pull requests each person opened
// were reviewed, over the report's window. A row stacks below `sm`.
const props = defineProps<{ people: PersonReport[] }>()

const order = ref<PeopleOrder>('reviewed')
const query = ref('')
const shown = computed(() => orderPeople(props.people, order.value, query.value))
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-semibold">People</h2>
      <p class="text-sm text-muted">
        Reviews given on the pull requests opened in the window, each pull request counted once, and
        how long the pull requests each person opened waited. Bots are left out.
      </p>
    </template>

    <div class="flex flex-col gap-3 mb-3 sm:flex-row sm:items-end">
      <UFormField label="Order">
        <USelect v-model="order" :items="PEOPLE_ORDERS" value-key="value" class="w-full sm:w-64" />
      </UFormField>
      <UFormField label="Find a person">
        <UInput v-model="query" placeholder="Name or handle" class="w-full sm:w-64" />
      </UFormField>
    </div>

    <p v-if="people.length === 0" class="text-sm text-muted">
      Nobody opened or reviewed a pull request in the window.
    </p>
    <p v-else-if="shown.length === 0" class="text-sm text-muted">Nobody matches.</p>
    <ul v-else class="divide-y divide-default">
      <li
        v-for="person in shown"
        :key="`${person.provider}:${person.login}`"
        class="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4"
      >
        <div class="w-full min-w-0 sm:w-56">
          <p class="font-medium truncate">{{ personName(person) }}</p>
          <p class="text-xs text-muted truncate">
            {{ person.login }} on {{ vcsDisplayName(person.provider) }}
          </p>
        </div>
        <dl class="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-5">
          <div>
            <dt class="text-xs text-muted">Reviewed</dt>
            <dd class="tabular-nums">{{ person.reviewed }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">Approved</dt>
            <dd class="tabular-nums">{{ person.approved }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">First to review</dt>
            <dd class="tabular-nums">{{ person.firstToReview }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">Opened</dt>
            <dd class="tabular-nums">{{ person.authored }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">Median wait for review</dt>
            <dd class="tabular-nums">
              {{ formatDuration(person.authoredMetrics.first_human_review.medianMs) }}
              <span
                v-if="person.authoredMetrics.first_human_review.waiting > 0"
                class="text-xs text-muted"
              >
                ({{ person.authoredMetrics.first_human_review.waiting }} waiting)
              </span>
            </dd>
          </div>
        </dl>
      </li>
    </ul>
  </UCard>
</template>
