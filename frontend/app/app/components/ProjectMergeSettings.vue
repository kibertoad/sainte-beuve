<script setup lang="ts">
import type { MergeComment, Project, UpdateProject } from '@sainte-beuve/contracts'

// How one project merges from My PRs: its own merge comments, or the ones it
// inherits, and whether a direct merge is refused while comments are in force.
const props = defineProps<{ project: Project; busy: boolean }>()

const emit = defineEmits<{ save: [patch: UpdateProject] }>()

const open = ref(false)
const comments = ref<MergeComment[] | null>(props.project.mergeComments)
const restrict = ref(props.project.restrictDirectMerge)

watch(
  () => props.project,
  (project) => {
    comments.value = project.mergeComments
    restrict.value = project.restrictDirectMerge
  },
)

const summary = computed(() => {
  const own = props.project.mergeComments
  const source =
    own === null
      ? 'Inherits merge comments'
      : `${own.length} merge comment${own.length === 1 ? '' : 's'} of its own`
  return props.project.restrictDirectMerge ? `${source}, merges only through them` : source
})

const changed = computed(
  () =>
    !sameMergeComments(cleanMergeComments(comments.value), props.project.mergeComments) ||
    restrict.value !== props.project.restrictDirectMerge,
)

function save() {
  emit('save', {
    mergeComments: cleanMergeComments(comments.value),
    restrictDirectMerge: restrict.value,
  })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        size="sm"
        variant="ghost"
        color="neutral"
        :icon="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        @click="open = !open"
      >
        Merge settings
      </UButton>
      <span class="text-sm text-muted">{{ summary }}</span>
    </div>
    <div v-if="open" class="flex flex-col gap-4 sm:pl-4">
      <MergeCommentsEditor v-model="comments" inherit-from="the team's or organization's" />
      <UCheckbox
        v-model="restrict"
        label="Merge only through the merge comments"
        description="My PRs refuses a direct merge while merge comments are in force for this repository. Admins can still override it."
      />
      <div class="flex flex-wrap items-center justify-end gap-3">
        <span v-if="changed" class="text-sm text-warning">Unsaved changes</span>
        <UButton size="sm" variant="soft" :disabled="!changed" :loading="busy" @click="save()">
          Save merge settings
        </UButton>
      </div>
    </div>
  </div>
</template>
