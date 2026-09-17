<script setup lang="ts">
// The layer's root: a side rail of destinations, and the page beside it. A
// consuming deployment inherits this unless it ships its own.
//
// The workspace is first and is the landing route, because it is the only
// screen about the person in front of it: the board, the directory and the
// configuration are all about the deployment.
const links = [
  { label: 'Workspace', to: '/', icon: 'i-lucide-layout-dashboard' },
  { label: 'Projects', to: '/projects', icon: 'i-lucide-folder-git-2' },
  { label: 'Board', to: '/board', icon: 'i-lucide-git-pull-request' },
  { label: 'Reviewers', to: '/reviewers', icon: 'i-lucide-users' },
  { label: 'Configuration', to: '/configuration', icon: 'i-lucide-settings' },
]

// Who the screens are rendering FOR, at the foot of the rail.
//
// It belongs in the shell rather than on the workspace, because the answer
// applies to every screen: the board a person acts on and the inbox they are in
// are both cut by who is asking. A deployment running open has nobody signed in
// and says so, which is the honest reading of a workspace that renders for
// whoever the deployment's credential acts as.
const auth = useAuthState()
await auth.refresh()

/**
 * What the foot of the rail says. Three states, and they are three different
 * instructions: a person, a machine that has no workspace, and nobody. The
 * BUTTONS are on Configuration rather than here, because signing in is a
 * navigation away from whatever screen this is and the deployment's access
 * settings are what somebody wants to see when they get there.
 */
const whoami = computed(() => {
  const principal = auth.state.value?.principal
  if (principal?.kind === 'session') return principal.viewer.reviewer.displayName
  if (principal?.kind === 'api_key') return `API key: ${principal.label}`
  return auth.canSignIn.value ? 'Not signed in' : null
})
</script>

<template>
  <UApp>
    <div class="min-h-screen flex">
      <aside class="w-56 shrink-0 border-r border-default flex flex-col gap-4 p-4">
        <span class="font-semibold px-2.5">sainte-beuve</span>
        <UNavigationMenu orientation="vertical" :items="links" />
        <NuxtLink
          v-if="whoami"
          to="/configuration"
          class="mt-auto flex items-center gap-2 px-2.5 py-2 text-sm text-muted hover:text-default"
        >
          <UIcon name="i-lucide-user-round" />
          <span class="truncate">{{ whoami }}</span>
        </NuxtLink>
      </aside>
      <main class="flex-1 min-w-0">
        <NuxtPage />
      </main>
    </div>
  </UApp>
</template>
