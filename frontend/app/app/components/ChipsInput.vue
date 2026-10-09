<script setup lang="ts">
// A list of short labels (skills, domains) as removable chips, with the known
// ones offered as you type.
//
// Labels are matched by spelling wherever they are used, so offering the ones
// already in use is what keeps `Backend` and `backend` from becoming two. A
// new one that differs from a known one only by case takes the known spelling.
const props = withDefaults(
  defineProps<{
    suggestions: readonly string[]
    placeholder?: string
    /** False when only a known label may be picked, and typing one in is not an option. */
    creatable?: boolean
  }>(),
  { placeholder: 'Add', creatable: true },
)
const values = defineModel<string[]>({ required: true })

const items = computed(() => [...new Set([...props.suggestions, ...values.value])].sort())

function create(typed: string) {
  const entry = typed.trim()
  if (entry === '') return
  const known = items.value.find((label) => label.toLowerCase() === entry.toLowerCase())
  const label = known ?? entry
  if (!values.value.includes(label)) values.value = [...values.value, label]
}
</script>

<template>
  <UInputMenu
    v-model="values"
    multiple
    :items="items"
    :create-item="creatable"
    :placeholder="placeholder"
    class="w-full sm:w-96"
    @create="create"
  />
</template>
