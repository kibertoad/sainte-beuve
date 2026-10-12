import type { SlackAppManifest } from '@sainte-beuve/contracts'
import { DEFAULT_ORG_SLUG, slackWebhookPath } from '@sainte-beuve/contracts'

/**
 * The bot scopes the code calls on, and nothing past them: Slack shows this list
 * to whoever installs the app, and a scope nobody uses is one more reason to say no.
 *
 * - `chat:write` for `chat.postMessage` and `chat.update`, which is every message
 *   `SlackChatGateway` sends, DMs included: a DM is posted to the user id, so no
 *   `im:write` is needed.
 * - `chat:write.public` so the announcement reaches its channel without the bot
 *   being invited there first.
 * - `commands` for the `/review` slash command.
 *
 * Buttons answer on their `response_url`, which needs no scope.
 */
export const SLACK_BOT_SCOPES = ['chat:write', 'chat:write.public', 'commands'] as const

const APP_NAME = 'sainte-beuve'
/** Slack's limit on `display_information.name`. */
const APP_NAME_LIMIT = 35

export interface SlackManifestInput {
  /** The API's public origin, such as `https://api.example.com`, with no trailing slash. */
  apiOrigin: string
  org: { slug: string; name: string }
}

/** The manifest an org's Slack app is created from, and the Request URL written into it. */
export function slackAppManifest(input: SlackManifestInput): {
  requestUrl: string
  manifest: SlackAppManifest
} {
  const requestUrl = `${input.apiOrigin}${slackWebhookPath(input.org.slug)}`
  return {
    requestUrl,
    manifest: {
      display_information: {
        name: appName(input.org),
        description: 'Review requests, reminders and the /review command.',
      },
      features: {
        // The Messages tab is where the bot's DMs land. Read-only, because
        // nothing reads what a person writes back.
        app_home: {
          home_tab_enabled: false,
          messages_tab_enabled: true,
          messages_tab_read_only_enabled: true,
        },
        bot_user: { display_name: APP_NAME, always_online: false },
        slash_commands: [
          {
            command: '/review',
            url: requestUrl,
            description: 'Reviews waiting on you, and what to do with one',
            usage_hint: '[take | reroll | snooze | ai] <id>',
            should_escape: false,
          },
        ],
      },
      oauth_config: { scopes: { bot: [...SLACK_BOT_SCOPES] } },
      settings: {
        interactivity: { is_enabled: true, request_url: requestUrl },
        org_deploy_enabled: false,
        socket_mode_enabled: false,
        token_rotation_enabled: false,
      },
    },
  }
}

/** The default org's app is plain `sainte-beuve`; another org's carries its name, cut to fit. */
function appName(org: SlackManifestInput['org']): string {
  if (org.slug === DEFAULT_ORG_SLUG) return APP_NAME
  const room = APP_NAME_LIMIT - APP_NAME.length - ' ()'.length
  const name = org.name.length > room ? org.name.slice(0, room).trimEnd() : org.name
  return `${APP_NAME} (${name})`
}
