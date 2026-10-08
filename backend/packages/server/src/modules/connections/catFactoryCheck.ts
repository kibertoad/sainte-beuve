import type {
  CatFactoryCheck,
  CatFactoryCheckStep,
  CatFactoryConfig,
} from '@sainte-beuve/contracts'
import type { CatFactoryProbeReport } from '@sainte-beuve/kernel'

/**
 * Where the key a check ran with came from, or null when there was none.
 * `elsewhere` is a stored key that was not used, because the URL checked is not
 * the stored one.
 */
export type CheckedKey = 'entered' | 'stored' | 'elsewhere' | null

type Verdict = Pick<CatFactoryCheckStep, 'outcome' | 'message'>

interface CheckContext {
  config: CatFactoryConfig
  key: CheckedKey
  report: CatFactoryProbeReport
}

interface StepDefinition {
  step: CatFactoryCheckStep['step']
  /** A failure here leaves nothing after it worth asking, so every later step is skipped. */
  gates: boolean
  judge(context: CheckContext): Verdict
}

const passed = (message: string): Verdict => ({ outcome: 'passed', message })
const failed = (message: string): Verdict => ({ outcome: 'failed', message })
const skipped = (message: string): Verdict => ({ outcome: 'skipped', message })

/** cat-factory's scope ladder is inclusive, so a rung at or above `decide` can file a review. */
const SCOPES_THAT_FILE_REVIEWS = new Set(['decide', 'admin'])

/** What a key that was refused at authentication is told, by the probe's outcome. */
const REFUSALS: Partial<Record<CatFactoryProbeReport['outcome'], string>> = {
  unauthorized: 'cat-factory does not accept this key',
  refused: 'cat-factory refused the request',
}

/** The two ids the instance is asked to recognise, and how each is reported. */
interface ListedId {
  field: 'serviceId' | 'pipelineId'
  among: (report: CatFactoryProbeReport) => { id: string; name: string }[]
  absent: string
  found: (name: string) => string
  noun: string
}

const SERVICE: ListedId = {
  field: 'serviceId',
  among: (report) => report.services.map((s) => ({ id: s.id, name: s.title })),
  absent: 'No service id, so AI reviews stay off until one is chosen.',
  found: (name) => `AI reviews are filed under ${name}.`,
  noun: 'service',
}

const PIPELINE: ListedId = {
  field: 'pipelineId',
  among: (report) => report.pipelines,
  absent: "No pipeline, so reviews run on the review task's own.",
  found: (name) => `AI reviews run on ${name}.`,
  noun: 'pipeline',
}

function listed(spec: ListedId): StepDefinition['judge'] {
  return ({ config, report }) => {
    const id = config[spec.field]
    if (id === null) return skipped(spec.absent)
    const found = spec.among(report).find((entry) => entry.id === id)
    return found === undefined
      ? failed(`This key cannot see a ${spec.noun} ${id}.`)
      : passed(spec.found(found.name))
  }
}

const KEY_VERDICTS: Record<NonNullable<CheckedKey> | 'none', Verdict> = {
  entered: passed('Checking the key entered above.'),
  stored: passed('Checking the stored key.'),
  elsewhere: failed(
    'The stored key is only sent to the saved base URL. Paste the key for this one above to check it.',
  ),
  none: failed('There is no key to check with: paste one, or store one first.'),
}

/** The steps, in the order they run and are shown. */
const STEPS: readonly StepDefinition[] = [
  {
    step: 'key',
    gates: true,
    judge: ({ key }) => KEY_VERDICTS[key ?? 'none'],
  },
  {
    step: 'reachable',
    gates: true,
    judge: ({ config, report }) =>
      report.outcome === 'unreachable'
        ? failed(
            `No cat-factory API answered at ${config.baseUrl}: ${report.detail ?? 'no detail'}`,
          )
        : passed(`cat-factory answered at ${config.baseUrl}.`),
  },
  {
    step: 'authenticated',
    gates: true,
    judge: ({ report }) => {
      const refusal = REFUSALS[report.outcome]
      return refusal === undefined
        ? passed('cat-factory accepted the key.')
        : failed(`${refusal}: ${report.detail ?? 'no detail'}`)
    },
  },
  {
    step: 'scope',
    gates: false,
    judge: ({ report }) =>
      report.scope !== null && SCOPES_THAT_FILE_REVIEWS.has(report.scope)
        ? passed(`The key has the ${report.scope} scope, which can file AI reviews.`)
        : failed(
            `The key has the ${report.scope ?? 'unknown'} scope. Filing an AI review needs decide, ` +
              'because the review stops on its findings and waits for an answer. Guided review ' +
              'works without it.',
          ),
  },
  { step: 'service', gates: false, judge: listed(SERVICE) },
  { step: 'pipeline', gates: false, judge: listed(PIPELINE) },
]

/** What the steps are judged against when there was no key, so nothing was asked. */
const NOT_ASKED: CatFactoryProbeReport = {
  outcome: 'unreachable',
  detail: null,
  scope: null,
  services: [],
  pipelines: [],
}

const NOT_CHECKED = skipped('Not checked, because an earlier step failed.')

/**
 * What a check found, as steps a screen shows in order.
 *
 * Pure over what the probe reported, so every message is decided here and a
 * suite can cover them without an instance. The first gating step that fails
 * marks every later one skipped, so the screen points at one thing to fix.
 */
export function catFactoryCheck(
  config: CatFactoryConfig,
  key: CheckedKey,
  report: CatFactoryProbeReport | null,
): CatFactoryCheck {
  const context: CheckContext = { config, key, report: report ?? NOT_ASKED }
  const steps: CatFactoryCheckStep[] = []
  let blocked = false
  for (const definition of STEPS) {
    const verdict: Verdict = blocked ? NOT_CHECKED : definition.judge(context)
    steps.push({ step: definition.step, ...verdict })
    blocked ||= definition.gates && verdict.outcome === 'failed'
  }
  return {
    ok: steps.every((entry) => entry.outcome !== 'failed'),
    steps,
    services: report?.services ?? [],
    pipelines: report?.pipelines ?? [],
  }
}
