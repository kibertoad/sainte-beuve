import { DEFAULT_PROJECT_SKILLS } from '@sainte-beuve/contracts'

/**
 * Every skill in use on a repository or a reviewer, for a skills field to offer.
 *
 * One vocabulary for both, because they are matched against each other: an ask
 * for a repository's skill reaches only reviewers who list it in the same
 * spelling. `live` is the screen's own copy of one of the two lists, so an edit
 * saved there is offered at once rather than after the next read. A failed read
 * only narrows what is offered.
 */
export function useKnownSkills(live: () => readonly string[] = () => []) {
  const api = useSainteBeuveApi()
  const { data } = useAsyncData(
    'known-skills',
    async () => {
      const [projects, reviewers] = await Promise.allSettled([
        api.listProjects(),
        api.listReviewers(),
      ])
      return [
        ...(projects.status === 'fulfilled' ? projects.value.projects : []),
        ...(reviewers.status === 'fulfilled' ? reviewers.value.reviewers : []),
      ].flatMap((row) => row.skills)
    },
    { lazy: true },
  )
  return computed(() => [...new Set([...DEFAULT_PROJECT_SKILLS, ...(data.value ?? []), ...live()])])
}
