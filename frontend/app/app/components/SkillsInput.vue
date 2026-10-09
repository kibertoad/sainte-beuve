<script setup lang="ts">
// A skill list as removable chips, with the known skills offered as you type
// and anything else added as a new one.
//
// A skill is matched by its exact spelling everywhere it is used, so offering
// the ones already in use is what keeps `Backend` and `backend` from becoming
// two vocabularies. A new one that differs from a known one only by case is
// taken in the known spelling.
const props = defineProps<{ suggestions: readonly string[] }>()
const skills = defineModel<string[]>({ required: true })

const items = computed(() => [...new Set([...props.suggestions, ...skills.value])].sort())

function create(typed: string) {
  const entry = typed.trim()
  if (entry === '') return
  const known = items.value.find((skill) => skill.toLowerCase() === entry.toLowerCase())
  const skill = known ?? entry
  if (!skills.value.includes(skill)) skills.value = [...skills.value, skill]
}
</script>

<template>
  <UInputMenu
    v-model="skills"
    multiple
    :items="items"
    create-item
    placeholder="Add a skill"
    class="w-full sm:w-96"
    @create="create"
  />
</template>
