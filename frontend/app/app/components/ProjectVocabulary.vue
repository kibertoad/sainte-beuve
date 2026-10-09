<script setup lang="ts">
import type { Project, UpdateProject } from '@sainte-beuve/contracts'

// What one registered repository is matched on, editable in place.
const props = defineProps<{
  project: Project
  knownSkills: readonly string[]
  knownDomains: readonly string[]
  busy: boolean
}>()

const emit = defineEmits<{ save: [patch: UpdateProject] }>()

const skills = ref([...props.project.skills])
const domains = ref([...props.project.domains])

// Re-seeded after a save, which re-reads the repository.
watch(
  () => props.project,
  (project) => {
    skills.value = [...project.skills]
    domains.value = [...project.domains]
  },
)

const changed = computed(
  () =>
    !sameList(skills.value, props.project.skills) ||
    !sameList(domains.value, props.project.domains),
)

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

function save() {
  emit('save', { skills: skills.value, domains: domains.value })
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <MatchingFields
      v-model:skills="skills"
      v-model:domains="domains"
      :known-skills="knownSkills"
      :known-domains="knownDomains"
    />
    <div class="flex flex-wrap items-center gap-3">
      <UButton size="sm" variant="soft" :disabled="!changed" :loading="busy" @click="save()">
        Save skills and domains
      </UButton>
      <span v-if="changed" class="text-sm text-warning">Unsaved changes</span>
    </div>
  </div>
</template>
