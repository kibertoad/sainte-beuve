/**
 * Where `lg` is, as a media query rather than a number: the shell's rail appears
 * at Tailwind's `lg`, and the overlay that stands in for it below that has to
 * close at exactly the same width or the two render at once.
 */
const RAIL_BREAKPOINT = '(min-width: 64rem)'

/**
 * The overlay rail's open state, and every way it closes.
 *
 * Only reachable below `lg`, where the button that opens it is the only way to a
 * second screen. THREE closes, because no one of them covers the others:
 *
 * - a NAVIGATION, which is the usual one, and which the menu reports itself
 *   because tapping the destination you are already on changes no route;
 * - a ROUTE change, which catches the navigations no click produced — a redirect
 *   after a sign-in, the back button, a `navigateTo` from a page below;
 * - a VIEWPORT that reached `lg`, where the rail renders beside the page and a
 *   modal copy of it left on top would be the same navigation twice, over a
 *   page whose scroll the overlay still holds.
 */
export function useNavigationOverlay() {
  const open = ref(false)

  function close(): void {
    open.value = false
  }

  const route = useRoute()
  watch(() => route.fullPath, close)

  // The layer is `ssr: false`, so `window` is there by `onMounted`; the listener
  // is still torn down, because a consuming deployment may mount this shell
  // more than once over the life of a tab.
  let rail: MediaQueryList | null = null
  function onRailChange(event: MediaQueryListEvent): void {
    if (event.matches) close()
  }

  onMounted(() => {
    rail = window.matchMedia(RAIL_BREAKPOINT)
    rail.addEventListener('change', onRailChange)
  })
  onBeforeUnmount(() => {
    rail?.removeEventListener('change', onRailChange)
    rail = null
  })

  return { open, close }
}
