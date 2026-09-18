<script setup lang="ts">
import type { CreateReviewer, Reviewer } from '@sainte-beuve/contracts'
import { knownHandles } from '@sainte-beuve/contracts'
import { reviewerPatch } from '../utils/reviewerDraft'

// The reviewer directory: who is in the pool, what they can take, and which
// team an attention request can keep an ask inside.
//
// Manageable from here rather than from curl, because the pool is what every
// other screen depends on: a review the router cannot fill, an ask that reaches
// nobody and a workspace rendering for the wrong person are all a directory
// somebody could not edit.
//
// There is no delete, on purpose. `paused` is the way out of the pool: it keeps
// the skills, the team and the host accounts, so somebody back from leave
// reappears as themselves instead of being retyped. A row is also what the
// reviews and the linked host accounts point AT, so removing one would leave a
// board row assigned to nobody and a signed-in account attached to nothing.
const api = useSainteBeuveApi()
const { data, pending, error, refresh } = await useAsyncData('reviewers', () => api.listReviewers())

const reviewers = computed<Reviewer[]>(() => data.value?.reviewers ?? [])
const { busy, run } = useApiAction({ refresh })

/** Whether the add form is open, and which row is being edited. Never both. */
const adding = ref(false)
// Holds the row AS IT WAS when Edit was pressed, rather than just its id. That
// snapshot is what a save is diffed against, so a field this form never touched is
// never sent, whatever has happened to the row in the meantime.
const editing = ref<Reviewer | null>(null)

// Let go of an edit target the list no longer holds. A refresh that fails leaves
// `reviewers` empty, which unmounts the open form along with the Cancel button that
// is the only control clearing this, and every Edit button is disabled while it is
// set. Without this the screen comes back from a blip with all of them dead.
watch(reviewers, (rows) => {
  const open = editing.value
  if (open !== null && !rows.some((row) => row.id === open.id)) {
    editing.value = null
  }
})

function startAdding() {
  editing.value = null
  adding.value = true
}

function startEditing(reviewer: Reviewer) {
  adding.value = false
  editing.value = reviewer
}

/**
 * Every host account the person is known by. Shown as a list rather than as one
 * login, because that is what makes a workspace find their pull requests: a
 * reviewer with no handle on the host a project lives on is invisible there,
 * and this is the only screen that says so.
 */
function handles(reviewer: Reviewer): string {
  const known = knownHandles(reviewer.handles)
  return known.length === 0 ? 'no host account' : known.join(', ')
}

async function add(draft: CreateReviewer) {
  if (await run(() => api.createReviewer(draft), 'Could not add the reviewer', 'add')) {
    adding.value = false
  }
}

async function save(draft: CreateReviewer) {
  const opened = editing.value
  if (opened === null) return
  // Only what THIS form moved, diffed against the row as it was when Edit was
  // pressed. Posting every field the form holds, or diffing against the row as it
  // stands now, both revert whatever changed while the form was open: pause
  // somebody in a second tab, save a form opened before that, and they come back.
  const patch = reviewerPatch(opened, draft)
  if (await run(() => api.updateReviewer(opened.id, patch), 'Could not save', opened.id)) {
    editing.value = null
  }
}

/**
 * The one-click half of availability, which is the edit people actually make.
 * Going heads-down should not mean opening a form with seven fields on it.
 */
function togglePause(reviewer: Reviewer) {
  const availability = reviewer.availability === 'available' ? 'paused' : 'available'
  return run(
    () => api.updateReviewer(reviewer.id, { availability }),
    'Could not change availability',
    reviewer.id,
  )
}
</script>

<template>
  <UContainer class="py-6 sm:py-8">
    <div class="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-semibold">Reviewers</h1>
        <p class="text-sm text-muted">
          The pool a review is routed into, and the skills each person can be asked for.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <UButton icon="i-lucide-refresh-cw" variant="ghost" :loading="pending" @click="refresh()">
          Refresh
        </UButton>
        <UButton icon="i-lucide-user-plus" :disabled="adding" @click="startAdding()">
          Add a reviewer
        </UButton>
      </div>
    </div>

    <UCard v-if="adding" class="mb-4">
      <template #header>
        <h2 class="font-medium">Add a reviewer</h2>
      </template>
      <ReviewerForm
        :reviewer="null"
        :busy="busy === 'add'"
        submit-label="Add"
        @submit="add"
        @cancel="adding = false"
      />
    </UCard>

    <ApiErrorAlert v-if="error" :error="error" title="Could not read the reviewer pool" />

    <UCard v-else-if="reviewers.length === 0 && !adding">
      <p class="text-sm text-muted">
        Nobody is in the pool yet. Until somebody is, a review has nobody to be routed to and an ask
        for attention reaches nobody.
      </p>
    </UCard>

    <div v-else class="flex flex-col gap-3">
      <UCard v-for="reviewer in reviewers" :key="reviewer.id">
        <div v-if="editing?.id === reviewer.id">
          <p class="font-medium mb-4">Editing {{ reviewer.displayName }}</p>
          <!-- Seeded from the snapshot, which is also what the save is diffed against. -->
          <ReviewerForm
            :reviewer="editing"
            :busy="busy === reviewer.id"
            submit-label="Save"
            @submit="save"
            @cancel="editing = null"
          />
        </div>

        <div
          v-else
          class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
        >
          <div class="min-w-0">
            <p class="font-medium">{{ reviewer.displayName }}</p>
            <p class="text-sm text-muted">
              {{ handles(reviewer) }}
              <template v-if="reviewer.team"> &middot; {{ reviewer.team }}</template>
              <template v-if="reviewer.weight !== 1">
                &middot; weight {{ reviewer.weight }}
              </template>
            </p>
            <div class="flex flex-wrap gap-1 mt-2">
              <UBadge v-for="skill in reviewer.skills" :key="skill" variant="subtle" size="sm">
                {{ skill }}
              </UBadge>
              <span v-if="reviewer.skills.length === 0" class="text-xs text-muted">
                No skills recorded, so a review asking for one never reaches them.
              </span>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3 sm:shrink-0">
            <div class="sm:text-right">
              <UBadge
                :color="reviewer.availability === 'available' ? 'success' : 'neutral'"
                variant="subtle"
              >
                {{ reviewer.availability }}
              </UBadge>
              <p class="text-xs text-muted mt-1">{{ reviewer.outstandingReviews }} outstanding</p>
            </div>
            <UButton
              size="sm"
              variant="soft"
              color="neutral"
              :loading="busy === reviewer.id"
              @click="togglePause(reviewer)"
            >
              {{ reviewer.availability === 'available' ? 'Pause' : 'Resume' }}
            </UButton>
            <UButton
              size="sm"
              variant="ghost"
              icon="i-lucide-pencil"
              :disabled="editing !== null"
              @click="startEditing(reviewer)"
            >
              Edit
            </UButton>
          </div>
        </div>
      </UCard>
    </div>
  </UContainer>
</template>
