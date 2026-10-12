import { describe, expect, it } from 'vitest'
import { slackAppManifest } from './manifest.js'

const API = 'https://api.example.com'

describe('slackAppManifest', () => {
  it("points the command and the buttons at the default org's Request URL", () => {
    const { requestUrl, manifest } = slackAppManifest({
      apiOrigin: API,
      org: { slug: 'default', name: 'Default' },
    })
    expect(requestUrl).toBe('https://api.example.com/webhooks/slack/default')
    expect(manifest.settings.interactivity).toStrictEqual({
      is_enabled: true,
      request_url: requestUrl,
    })
    expect(manifest.features.slash_commands.map(({ command, url }) => [command, url])).toEqual([
      ['/review', requestUrl],
    ])
    expect(manifest.display_information.name).toBe('sainte-beuve')
  })

  it("puts a named org's slug in its URL and its name on the app", () => {
    const { requestUrl, manifest } = slackAppManifest({
      apiOrigin: API,
      org: { slug: 'acme', name: 'Acme' },
    })
    expect(requestUrl).toBe('https://api.example.com/webhooks/slack/acme')
    expect(manifest.settings.interactivity.request_url).toBe(requestUrl)
    expect(manifest.features.slash_commands[0]?.url).toBe(requestUrl)
    expect(manifest.display_information.name).toBe('sainte-beuve (Acme)')
  })

  it("cuts a long org name to Slack's 35 characters", () => {
    const { manifest } = slackAppManifest({
      apiOrigin: API,
      org: { slug: 'long', name: 'The Extremely Long Name Of An Org' },
    })
    expect(manifest.display_information.name).toBe('sainte-beuve (The Extremely Long N)')
    expect(manifest.display_information.name).toHaveLength(35)
  })

  it('cuts by character, so an emoji at the limit stays whole', () => {
    const { manifest } = slackAppManifest({
      apiOrigin: API,
      org: { slug: 'cats', name: 'Nineteen characters\u{1F431} and more' },
    })
    expect(manifest.display_information.name).toBe('sainte-beuve (Nineteen characters\u{1F431})')
  })

  it('asks for the scopes the gateway and the command use, and no others', () => {
    const { manifest } = slackAppManifest({ apiOrigin: API, org: { slug: 'acme', name: 'Acme' } })
    expect(manifest.oauth_config.scopes.bot).toStrictEqual([
      'chat:write',
      'chat:write.public',
      'commands',
    ])
  })

  it('keeps the Messages tab on and open to /review, under a name Slack accepts for a bot', () => {
    const { manifest } = slackAppManifest({ apiOrigin: API, org: { slug: 'acme', name: 'Acme' } })
    expect(manifest.features.app_home).toMatchObject({
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: false,
    })
    expect(manifest.features.bot_user.display_name).toMatch(/^[a-z0-9._-]+$/)
  })
})
