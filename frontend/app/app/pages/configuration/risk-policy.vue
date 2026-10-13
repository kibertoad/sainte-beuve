<script setup lang="ts">
import type { ApproverStatus, RiskPolicy, VcsProvider } from '@sainte-beuve/contracts'
import { vcsApproverCredentialKey, vcsDisplayName } from '@sainte-beuve/contracts'
import type { DraftHolder } from '../../composables/useIntegrationSettings'

// The org's risk policy, and the accounts automatic approvals go out as.
const settings = useIntegrationSettings()
const { api, auth } = settings

const { data, pending, error, refresh } = useAsyncData(
  'risk-policy',
  async () => {
    const current = await api.getRiskPolicy()
    const external =
      auth.isAdmin.value && current.catFactoryAvailable
        ? await api.listExternalRiskPolicies()
        : null
    return { ...current, external }
  },
  { lazy: true },
)

const { busy, run } = useApiAction({ refresh })

async function save(policy: RiskPolicy) {
  await run(() => api.setRiskPolicy(policy), 'Could not save the risk policy', 'risk-policy')
}

const providers: VcsProvider[] = ['github', 'gitlab']

const fields = ref<Partial<Record<VcsProvider, DraftHolder | null>>>({})

function approverLine(provider: VcsProvider, status: ApproverStatus | undefined): string {
  if (status === undefined || status.source === null) {
    return `Nothing approves on ${vcsDisplayName(provider)}: store a token below.`
  }
  const who = status.username === null ? '' : ` as ${status.username}`
  return status.source === 'token'
    ? `Approves${who}, with the token stored below.`
    : `Approves${who}, as this deployment's GitHub App, until a token is stored below.`
}

async function saveToken(provider: VcsProvider, token: string) {
  await settings.save(vcsApproverCredentialKey(provider), token, fields.value[provider] ?? null)
  await refresh()
}

async function clearToken(provider: VcsProvider) {
  await settings.clear(vcsApproverCredentialKey(provider))
  await refresh()
}
</script>

<template>
  <IntegrationScreen
    title="Risk policy"
    description="Which pull requests are assessed, and which of them are approved with nobody looking."
    :pending="pending"
    :error="error"
    :loaded="data != null"
    @refresh="refresh()"
  >
    <RiskPolicyCard
      v-if="data"
      :policy="data.policy"
      :cat-factory-available="data.catFactoryAvailable"
      :external-policies="data.external"
      :admin="auth.isAdmin.value"
      :busy="busy === 'risk-policy'"
      @save="save($event)"
    />

    <UCard v-if="data && settings.data.value">
      <div class="mb-4">
        <p class="font-medium">Approver</p>
        <p class="text-sm text-muted">
          The account automatic approvals go out as. Use a bot account with write access to the
          repositories: a person's token would approve as that person, and a host refuses an
          approval from a pull request's own author.
        </p>
      </div>
      <div class="flex flex-col gap-6">
        <div v-for="provider in providers" :key="provider" class="flex flex-col gap-2">
          <p class="text-sm font-medium">{{ vcsDisplayName(provider) }}</p>
          <p class="text-sm text-muted">{{ approverLine(provider, data.approvers[provider]) }}</p>
          <CredentialField
            :ref="(field) => (fields[provider] = field as DraftHolder | null)"
            :status="settings.statusOf(vcsApproverCredentialKey(provider))"
            :description="`A token for the ${vcsDisplayName(provider)} account that approves.`"
            :placeholder="provider === 'github' ? 'ghp_xxxxxxxxxxxx' : 'glpat-xxxxxxxxxxxx'"
            :busy="settings.busy.value === vcsApproverCredentialKey(provider)"
            @save="saveToken(provider, $event)"
            @clear="clearToken(provider)"
          />
        </div>
      </div>
    </UCard>
  </IntegrationScreen>
</template>
