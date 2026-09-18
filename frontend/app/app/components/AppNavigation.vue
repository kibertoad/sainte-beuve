<script setup lang="ts">
// The destinations, and who the screens are rendering FOR. One component because
// it is rendered TWICE: as the rail beside the page on a wide screen, and inside
// the slideover that replaces the rail on a narrow one. Two copies would drift
// the day a destination is added, and the drift would only show on a phone.
//
// The workspace is first and is the landing route, because it is the only
// screen about the person in front of it: the board, the directory and the
// configuration are all about the deployment.

// Rendered in two places, and one of them is a modal that has to close when you
// leave through it. The links are a `UNavigationMenu`, which renders its own
// anchors and reports no per-item click, so the one place every destination is
// reachable is the click on its way past this component's root. A click that
// landed on an anchor is a navigation to ANNOUNCE even when the route will not
// change: tapping the destination you are already on is how a phone menu is
// dismissed, and it produces no route change for anything else to notice.
const emit = defineEmits<{ navigate: [] }>()

function reportNavigation(event: MouseEvent): void {
  if (event.target instanceof Element && event.target.closest('a')) emit('navigate')
}

const links = [
  { label: 'Workspace', to: '/', icon: 'i-lucide-layout-dashboard' },
  { label: 'Projects', to: '/projects', icon: 'i-lucide-folder-git-2' },
  { label: 'Board', to: '/board', icon: 'i-lucide-git-pull-request' },
  { label: 'Reviewers', to: '/reviewers', icon: 'i-lucide-users' },
  // Kept for EVERYBODY, including a member who can change none of it. It holds
  // the Access card, which holds the only sign-out button there is, and a rail
  // that hid it from the people it refuses would leave them signed in with no
  // way out. What the page itself shows them is its own decision.
  { label: 'Configuration', to: '/configuration', icon: 'i-lucide-settings' },
]

// Read rather than refreshed: the shell does that once, and this renders in two
// places at once, so a fetch here would be the same call made twice.
const auth = useAuthState()

/**
 * The tenancy, above the person. Shown only for a deployment that made a second
 * org: a single-tenant one is entirely in the default org, and a rail that said
 * "default" on every screen would be reporting a fact nobody has to act on.
 */
const orgName = computed(() => {
  const org = auth.org.value
  return org === null || org.slug === 'default' ? null : org.name
})

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
  <div class="flex flex-col gap-4 h-full" @click="reportNavigation">
    <UNavigationMenu orientation="vertical" :items="links" />
    <div v-if="orgName || whoami" class="mt-auto flex flex-col gap-1">
      <p v-if="orgName" class="flex items-center gap-2 px-2.5 text-sm text-muted">
        <UIcon name="i-lucide-building-2" />
        <span class="truncate">{{ orgName }}</span>
      </p>
      <NuxtLink
        v-if="whoami"
        to="/configuration"
        class="flex items-center gap-2 px-2.5 py-2 text-sm text-muted hover:text-default"
      >
        <UIcon name="i-lucide-user-round" />
        <span class="truncate">{{ whoami }}</span>
      </NuxtLink>
    </div>
  </div>
</template>
