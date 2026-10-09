<script setup lang="ts">
// What a repository's reviews are matched on. The Add form and each registered
// repository show this same pair, so a repository is described the same way
// before it is added and after.
defineProps<{ knownSkills: readonly string[]; knownDomains: readonly string[] }>()
const skills = defineModel<string[]>('skills', { required: true })
const domains = defineModel<string[]>('domains', { required: true })
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="text-sm text-muted">
      Reviewers are drawn more often the more of these skills and domains they hold. Nobody is ruled
      out for missing one.
    </p>
    <UFormField
      label="Skills"
      description="What reviewing it takes. An attention request on it also picks from these."
    >
      <ChipsInput v-model="skills" :suggestions="knownSkills" placeholder="Add a skill" />
    </UFormField>
    <UFormField
      label="Domains"
      description="The areas of the product it belongs to. A new one joins the organization's list."
    >
      <ChipsInput v-model="domains" :suggestions="knownDomains" placeholder="Add a domain" />
    </UFormField>
  </div>
</template>
