<script setup lang="ts">
import { setPersonalPasswordViewer } from './utils/personalPassword'
// The layer's root: the destinations, and the page beside them. A consuming
// deployment inherits this unless it ships its own.
//
// The shell is the one place the viewport width changes the SHAPE of the screen
// rather than the size of it. A rail 56 units wide is a third of a phone, so
// below `lg` it becomes a bar with a button, and the same `AppNavigation` it
// always was renders inside a slideover instead of beside the page.
//
// Who the screens are rendering for is read ONCE, here, because every screen
// below is cut by who is asking: the board a person acts on and the inbox they
// are in both depend on it. A deployment running open has nobody signed in and
// says so, which is the honest reading of a workspace that renders for whoever
// the deployment's credential acts as.
const auth = useAuthState()
// NOT AWAITED. The shell suspends on whatever its setup awaits, so an awaited
// read here put `GET /auth` in front of every page's own fetch: first paint of
// any screen was two sequential round trips and a preflight rather than two
// overlapping ones. Nothing below needs the answer to issue its request — this
// rail renders a name from it, and `whoami` already tolerates null — so the read
// is started and the shell renders around it.
void auth.refresh()

// The cached cat-factory personal password is one per person, so the client is told who is acting.
watch(
  () => auth.viewer.value?.reviewer.id ?? null,
  (viewerId) => setPersonalPasswordViewer(viewerId),
  { immediate: true },
)

// The overlay rail's open state, and the closes that go with it. A slideover
// left standing over the page it just navigated to — or over the wide-screen
// rail it was only ever a stand-in for — is the standard way a phone menu is got
// wrong, so the closing lives in one composable rather than in this template.
const { open: navOpen, close: closeNav } = useNavigationOverlay()
</script>

<template>
  <UApp>
    <div class="min-h-screen lg:flex">
      <!--
        The narrow shell. Sticky, because the button on it is the only way off
        the screen and a long board would otherwise scroll it out of reach.
      -->
      <header
        class="lg:hidden sticky top-0 z-10 flex items-center gap-2 border-b border-default bg-default px-2 py-2"
      >
        <UButton
          icon="i-lucide-menu"
          variant="ghost"
          color="neutral"
          aria-label="Open the navigation"
          @click="navOpen = true"
        />
        <span class="font-semibold">sainte-beuve</span>
        <PersonaSwitcherButton class="ml-auto" />
      </header>

      <!--
        Sticky at the viewport's height: the rail's foot holds who the screens
        render for, and on a rail as tall as the page a long screen pushed it
        out of sight the moment its data landed.
      -->
      <aside
        class="hidden lg:flex lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto w-56 shrink-0 border-r border-default flex-col gap-4 p-4"
      >
        <div class="flex items-center justify-between gap-2 px-2.5">
          <span class="font-semibold">sainte-beuve</span>
          <PersonaSwitcherButton />
        </div>
        <AppNavigation />
      </aside>

      <USlideover v-model:open="navOpen" side="left" title="sainte-beuve">
        <template #body>
          <AppNavigation @navigate="closeNav()" />
        </template>
      </USlideover>

      <main class="flex-1 min-w-0">
        <NuxtPage />
      </main>
    </div>

    <!--
      Mounted ONCE, here, rather than per screen. Four of the actions that ask a
      question through it are on three different pages, and a modal per caller is
      how two of them end up open at the same time. See `useConfirm`.
    -->
    <ConfirmDialog />
    <PersonalRouteModal />
  </UApp>
</template>
