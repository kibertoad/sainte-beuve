<script setup lang="ts">
import type {
  CatFactoryCheck,
  CatFactoryCheckStep,
  CatFactoryConfig,
  CatFactoryConnection,
  IntegrationTokenStatus,
} from '@sainte-beuve/contracts'

// This org's cat-factory: where the instance is, which service AI reviews are
// filed under, which pipeline they run on, and the key. All of it is the org's
// and set here; none of it comes from the deployment's environment.
//
// The page owns the writes, because saving the settings can change whether the
// stored key is in use. The CHECK is made here: it stores nothing, and its
// result only means something next to the form it was run against.
const props = defineProps<{
  connection: CatFactoryConnection
  keyStatus: IntegrationTokenStatus
  busy?: boolean
}>()

const emit = defineEmits<{
  save: [config: CatFactoryConfig]
  clear: []
  saveKey: [token: string]
  clearKey: []
}>()

interface DraftHolder {
  clearDraft: () => void
  draftToken: () => string
}

const keyField = ref<DraftHolder | null>(null)

defineExpose({ key: { clearDraft: () => keyField.value?.clearDraft() } })

const api = useSainteBeuveApi()

/** The form starts from what is stored, else from what the deployment suggests. */
function initial(): { baseUrl: string; serviceId: string; pipelineId: string } {
  const from = props.connection.config ?? props.connection.suggested
  return {
    baseUrl: from?.baseUrl ?? '',
    serviceId: from?.serviceId ?? '',
    pipelineId: from?.pipelineId ?? '',
  }
}

const form = reactive(initial())

// The form follows what is stored when a save or a clear changes it. Watched by
// value: every action on the page re-reads the connection as a new object, and
// resetting on that would drop what is typed here when another card saves.
watch(
  [
    () => props.connection.config?.baseUrl,
    () => props.connection.config?.serviceId,
    () => props.connection.config?.pipelineId,
  ],
  () => Object.assign(form, initial()),
)

/** Blank fields are absent, not empty strings. */
const config = computed<CatFactoryConfig>(() => ({
  baseUrl: form.baseUrl.trim(),
  serviceId: form.serviceId.trim() || null,
  pipelineId: form.pipelineId.trim() || null,
}))

const suggesting = computed(
  () => props.connection.config === null && props.connection.suggested !== null,
)

interface Badge {
  color: 'success' | 'warning' | 'neutral'
  label: string
}

/** The badge, by the first rule the connection meets. */
const BADGES: readonly (Badge & { when: (connection: CatFactoryConnection) => boolean })[] = [
  { when: (c) => c.aiReviewReady, color: 'success', label: 'Ready' },
  { when: (c) => c.guidedReviewReady, color: 'warning', label: 'Guided review only' },
]

const NOT_CONFIGURED: Badge = { color: 'neutral', label: 'Not configured' }

const badge = computed(() => BADGES.find((rule) => rule.when(props.connection)) ?? NOT_CONFIGURED)

const checking = ref(false)
const result = ref<CatFactoryCheck | null>(null)
const checkFailure = ref<unknown>(null)

async function check(): Promise<void> {
  checking.value = true
  checkFailure.value = null
  const typed = keyField.value?.draftToken() ?? ''
  try {
    result.value = await api.checkCatFactory({
      ...config.value,
      ...(typed.length > 0 ? { apiKey: typed } : {}),
    })
  } catch (err) {
    result.value = null
    checkFailure.value = err
  } finally {
    checking.value = false
  }
}

const STEP_ICON = {
  passed: { icon: 'i-lucide-circle-check', class: 'text-success' },
  failed: { icon: 'i-lucide-circle-x', class: 'text-error' },
  skipped: { icon: 'i-lucide-circle-minus', class: 'text-muted' },
} satisfies Record<CatFactoryCheckStep['outcome'], { icon: string; class: string }>
</script>

<template>
  <UCard>
    <div
      class="flex flex-col-reverse gap-2 mb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
    >
      <div class="min-w-0">
        <p class="font-medium">cat-factory</p>
        <p class="text-sm text-muted">
          The instance AI reviews and guided reviews are delegated to. Set per org.
        </p>
      </div>
      <UBadge :color="badge.color" variant="subtle" class="self-start sm:shrink-0">
        {{ badge.label }}
      </UBadge>
    </div>

    <UAlert
      v-if="suggesting"
      class="mb-4"
      color="info"
      variant="subtle"
      title="Prefilled with a local cat-factory's defaults"
      description="Nothing reaches cat-factory until you save. Pick a service with Test connection, which lists the ones your key can see."
    />

    <div class="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-[10rem_1fr] sm:items-center">
      <label for="cf-base-url" class="text-sm font-medium">Base URL</label>
      <UInput
        id="cf-base-url"
        v-model="form.baseUrl"
        class="w-full"
        placeholder="http://localhost:8787"
      />
      <label for="cf-service" class="text-sm font-medium">Service id</label>
      <UInput
        id="cf-service"
        v-model="form.serviceId"
        class="w-full"
        placeholder="blk_… (needed for AI review)"
      />
      <label for="cf-pipeline" class="text-sm font-medium">Pipeline id</label>
      <UInput
        id="cf-pipeline"
        v-model="form.pipelineId"
        class="w-full"
        placeholder="Optional, e.g. pl_review"
      />
    </div>

    <div class="flex flex-col gap-2 mt-4 sm:flex-row sm:items-center">
      <UButton
        class="justify-center"
        :loading="busy"
        :disabled="config.baseUrl.length === 0"
        @click="emit('save', config)"
      >
        Save settings
      </UButton>
      <UButton
        variant="soft"
        icon="i-lucide-plug-zap"
        class="justify-center"
        :loading="checking"
        :disabled="config.baseUrl.length === 0"
        @click="check()"
      >
        Test connection
      </UButton>
      <UButton
        v-if="connection.config"
        variant="ghost"
        color="error"
        class="justify-center sm:ml-auto"
        :loading="busy"
        @click="emit('clear')"
      >
        Clear settings
      </UButton>
    </div>

    <ApiErrorAlert
      v-if="checkFailure"
      class="mt-4"
      :error="checkFailure"
      title="Could not run the check"
    />

    <div v-if="result" class="mt-4 text-sm">
      <ul class="flex flex-col gap-1.5">
        <li v-for="item in result.steps" :key="item.step" class="flex items-start gap-2">
          <UIcon
            :name="STEP_ICON[item.outcome].icon"
            :class="['size-4 mt-0.5 shrink-0', STEP_ICON[item.outcome].class]"
          />
          <span class="min-w-0 break-words">{{ item.message }}</span>
        </li>
      </ul>
      <div v-if="result.services.length > 0" class="mt-3">
        <p class="text-muted mb-1">Services this key can see</p>
        <div class="flex flex-wrap gap-1.5">
          <UButton
            v-for="service in result.services"
            :key="service.id"
            size="xs"
            :variant="form.serviceId === service.id ? 'solid' : 'soft'"
            @click="form.serviceId = service.id"
          >
            {{ service.title }}
          </UButton>
        </div>
      </div>
      <div v-if="result.pipelines.length > 0" class="mt-3">
        <p class="text-muted mb-1">Pipelines</p>
        <div class="flex flex-wrap gap-1.5">
          <UButton
            v-for="pipeline in result.pipelines"
            :key="pipeline.id"
            size="xs"
            :variant="form.pipelineId === pipeline.id ? 'solid' : 'soft'"
            @click="form.pipelineId = pipeline.id"
          >
            {{ pipeline.name }}
          </UButton>
        </div>
      </div>
    </div>

    <USeparator class="my-4" />

    <CredentialField
      ref="keyField"
      :status="keyStatus"
      :busy="busy"
      placeholder="cf_live_…"
      description="The API key, minted in cat-factory under its API access tokens. AI review needs the decide scope, because a review stops on its findings and waits for an answer; guided review works with write. Sealed before it is stored and never shown again, and sent only to the saved base URL: changing the URL removes it. Test connection uses a key typed here before the stored one."
      @save="emit('saveKey', $event)"
      @clear="emit('clearKey')"
    />
  </UCard>
</template>
