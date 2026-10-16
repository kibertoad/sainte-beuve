/** "All owners" in the URL when the org has a default owner, so a reload keeps the choice. */
const ALL_OWNERS_IN_URL = '*'

/**
 * The owner filter of a screen that keeps its filters in the URL: the owner the
 * URL names, else the org's default repository owner, else `all`. The URL
 * leaves `owner` out while the filter is at that default.
 */
export function useOwnerFilter(all: string) {
  const route = useRoute()
  const auth = useAuthState()
  const fallback = computed(() => auth.org.value?.defaultRepositoryOwner ?? all)
  const named = route.query.owner
  const fromUrl = typeof named === 'string' && named.length > 0 ? named : undefined
  const owner = ref(fromUrl === ALL_OWNERS_IN_URL ? all : (fromUrl ?? fallback.value))
  // The org can load after the screen does; its default fills a filter nobody has changed.
  if (fromUrl === undefined) {
    watch(fallback, (next, previous) => {
      if (owner.value === previous) owner.value = next
    })
  }
  const ownerQuery = computed(() => {
    if (owner.value === fallback.value) return undefined
    return owner.value === all ? ALL_OWNERS_IN_URL : owner.value
  })
  return { owner, ownerQuery }
}
