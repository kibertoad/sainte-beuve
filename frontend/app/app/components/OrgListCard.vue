<script setup lang="ts">
import type { Org } from '@sainte-beuve/contracts'

// Every org on this deployment, and the form that makes another. Admin-only.
// Creating one does not make the caller a member of it: the founder named here,
// or else the first account to sign in to it, becomes its admin.
const props = defineProps<{
  orgs: Org[]
  currentOrgId: string
  busy: boolean
}>()

const emit = defineEmits<{
  create: [
    org: { slug: string; name: string; founder: { provider: 'github'; handle: string } | null },
  ]
}>()

const slug = ref('')
const name = ref('')
const founder = ref('')

const ready = computed(() => slug.value.trim().length > 0 && name.value.trim().length > 0)

function create() {
  const handle = founder.value.trim()
  emit('create', {
    slug: slug.value.trim(),
    name: name.value.trim(),
    founder: handle.length === 0 ? null : { provider: 'github', handle },
  })
}

function clearDraft() {
  slug.value = ''
  name.value = ''
  founder.value = ''
}

defineExpose({ clearDraft })

const sorted = computed(() =>
  [...props.orgs].sort((left, right) => left.name.localeCompare(right.name)),
)
</script>

<template>
  <UCard>
    <div class="mb-4">
      <p class="font-medium">Organizations on this deployment</p>
      <p class="text-sm text-muted">
        Each one has its own board, directory, projects and integrations. People sign in to one by
        its slug.
      </p>
    </div>

    <ul class="flex flex-col divide-y divide-default mb-6">
      <li
        v-for="org in sorted"
        :key="org.id"
        class="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="min-w-0">
          <p class="font-medium truncate">{{ org.name }}</p>
          <p class="text-sm text-muted">
            <code>{{ org.slug }}</code>
          </p>
        </div>
        <UBadge v-if="org.id === currentOrgId" color="primary" variant="subtle" class="self-start">
          You are here
        </UBadge>
      </li>
    </ul>

    <div class="flex flex-col gap-5 max-w-xl">
      <p class="font-medium">Create an organization</p>
      <UFormField label="Slug" description="Lowercase letters, digits and dashes.">
        <UInput v-model="slug" class="w-full" placeholder="acme" />
      </UFormField>
      <UFormField label="Name">
        <UInput v-model="name" class="w-full" placeholder="Acme" />
      </UFormField>
      <UFormField
        label="Founding admin"
        description="Optional. The GitHub handle that becomes its admin. Without one, whoever signs in to it first does."
      >
        <UInput v-model="founder" class="w-full" placeholder="ada" />
      </UFormField>
      <div class="flex justify-end">
        <UButton :disabled="!ready" :loading="busy" @click="create()">Create</UButton>
      </div>
    </div>
  </UCard>
</template>
