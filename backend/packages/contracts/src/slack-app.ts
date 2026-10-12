import * as v from 'valibot'

/**
 * The subset of Slack's app manifest (https://docs.slack.dev/reference/app-manifest)
 * that sainte-beuve writes. The keys are Slack's, snake_case included, because the
 * value is pasted into Slack as it is.
 */
const slackSlashCommandSchema = v.object({
  command: v.string(),
  url: v.string(),
  description: v.string(),
  usage_hint: v.string(),
  should_escape: v.boolean(),
})

export const slackAppManifestSchema = v.object({
  display_information: v.object({
    name: v.string(),
    description: v.string(),
  }),
  features: v.object({
    app_home: v.object({
      home_tab_enabled: v.boolean(),
      messages_tab_enabled: v.boolean(),
      messages_tab_read_only_enabled: v.boolean(),
    }),
    bot_user: v.object({
      display_name: v.string(),
      always_online: v.boolean(),
    }),
    slash_commands: v.array(slackSlashCommandSchema),
  }),
  oauth_config: v.object({
    scopes: v.object({ bot: v.array(v.string()) }),
  }),
  settings: v.object({
    interactivity: v.object({
      is_enabled: v.boolean(),
      request_url: v.string(),
    }),
    org_deploy_enabled: v.boolean(),
    socket_mode_enabled: v.boolean(),
    token_rotation_enabled: v.boolean(),
  }),
})
export type SlackAppManifest = v.InferOutput<typeof slackAppManifestSchema>

/**
 * The manifest for the caller's org, or what the deployment is missing before it
 * can have one. Slack only accepts an https Request URL on a public host, so a
 * deployment without `API_BASE_URL` gets the reason instead of a manifest Slack
 * would refuse or, worse, accept with a URL nothing answers on.
 */
export const slackAppManifestResultSchema = v.variant('status', [
  v.object({
    status: v.literal('ready'),
    /** Where the slash command and the buttons post, as written into the manifest. */
    requestUrl: v.string(),
    manifest: slackAppManifestSchema,
  }),
  v.object({
    status: v.literal('unavailable'),
    /** What to configure, in a sentence the screen shows as it is. */
    missing: v.string(),
  }),
])
export type SlackAppManifestResult = v.InferOutput<typeof slackAppManifestResultSchema>
