import type { Team } from '@sainte-beuve/contracts'

/**
 * An org's teams. A name is unique within the org regardless of case, because
 * a reviewer refers to a team by name and the same-team gate compares names
 * case-insensitively.
 */
export interface TeamRepository {
  /** Every team, by name. */
  list(): Promise<Team[]>
  getById(teamId: string): Promise<Team | null>
  /** The team holding this name, compared case-insensitively. */
  getByName(name: string): Promise<Team | null>
  /**
   * Make one, or answer the team already holding the name. The same shape as
   * `OrgRepository.create`: a caller that lost the claim is told which row won.
   */
  create(team: Team): Promise<Team>
  /** Null when the team is gone. The caller checks a new name is free first. */
  update(
    teamId: string,
    patch: Partial<Pick<Team, 'name' | 'ownerId' | 'mergeComments'>>,
  ): Promise<Team | null>
  delete(teamId: string): Promise<void>
}
