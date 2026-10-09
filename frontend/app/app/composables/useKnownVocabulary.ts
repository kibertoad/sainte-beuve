import { DEFAULT_PROJECT_SKILLS } from '@sainte-beuve/contracts'

export interface LiveVocabulary {
  skills?: () => readonly string[]
  domains?: () => readonly string[]
}

/**
 * Every skill and every domain in use, for the chip fields to offer.
 *
 * One vocabulary for repositories and reviewers, because they are matched
 * against each other by spelling. Domains also come from the org's own list,
 * which is where an admin keeps them. `live` is the screen's own copy of a
 * list, so an edit saved there is offered at once rather than after the next
 * read. A failed read only narrows what is offered.
 */
export function useKnownVocabulary(live: LiveVocabulary = {}) {
  const api = useSainteBeuveApi()
  const auth = useAuthState()
  const { data } = useAsyncData(
    'known-vocabulary',
    async () => {
      const [projects, reviewers] = await Promise.allSettled([
        api.listProjects(),
        api.listReviewers(),
      ])
      return [
        ...(projects.status === 'fulfilled' ? projects.value.projects : []),
        ...(reviewers.status === 'fulfilled' ? reviewers.value.reviewers : []),
      ]
    },
    { lazy: true },
  )
  const rows = computed(() => data.value ?? [])

  const skills = computed(() => [
    ...new Set([
      ...DEFAULT_PROJECT_SKILLS,
      ...rows.value.flatMap((row) => row.skills),
      ...(live.skills?.() ?? []),
    ]),
  ])
  const domains = computed(() => [
    ...new Set([
      ...(auth.org.value?.domains ?? []),
      ...rows.value.flatMap((row) => row.domains),
      ...(live.domains?.() ?? []),
    ]),
  ])
  return { skills, domains }
}
