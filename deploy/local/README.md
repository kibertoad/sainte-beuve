# Local mode

Run the whole of sainte-beuve on your own machine. Nothing has to be registered
anywhere first.

```bash
pnpm dev:local            # API on http://localhost:8788
pnpm dev:frontend         # SPA on http://localhost:3000
```

That is the entire setup. No database, no Slack app, no GitHub app, no cat-factory
account: every integration is optional, and `GET /health` tells you which ones this
process wired.

## Your first workspace

The workspace is empty until it knows which repositories to sweep and who you
are. Register a project on the **Projects** screen, connect a credential for its
host, and the three lists fill themselves. Until then the screen says which of
the two is missing rather than showing an empty board.

## Attaching the real things, one at a time

Copy `.env.example` to `.env` and fill in only the block you care about.

- **cat-factory**: `CAT_FACTORY_BASE_URL` defaults to `http://localhost:8787`, where
  a local cat-factory serves. Add an API key and a service id and the "AI review"
  button starts filing real review tasks. Point the URL at the centralized instance
  instead and nothing else changes: it is the same client either way.
- **GitHub**: a personal access token is enough locally, and so is signing in with
  GitHub if you register an OAuth app with the loopback callback. Assignments then
  mirror onto the real pull request and the bot can comment on it. Whichever
  credential you set is also who the workspace renders for, because there are
  no sessions yet.
- **GitLab**: a personal access token, or an OAuth application whose callback is
  `http://localhost:8788/connect/gitlab/callback`. Set `GITLAB_BASE_URL` for a
  self-managed install; it configures the API and the OAuth endpoints together.
- **Slack**: a bot token and a channel id, and the reminder clock (every 15s in local
  mode, rather than hourly) delivers to a real channel.

Both OUTBOUND halves work with nothing but a credential. The inbound halves (GitHub
deliveries, the `/review` command, the message buttons) need GitHub and Slack to
reach your machine, which a tunnel solves:

```bash
cloudflared tunnel --url http://localhost:8788
```

Point the Request URLs at whatever it prints, and set `GITHUB_WEBHOOK_SECRET` and
`SLACK_SIGNING_SECRET` to match; without them every delivery is refused rather than
trusted. See [docs/integrations.md](../../docs/integrations.md).

The Configuration screen needs nothing: local mode generates a credential-encryption
key at boot. It is ephemeral on purpose, because the store behind it is in-memory, so
a token entered in the SPA does not survive a restart either way. Set
`SETTINGS_ENCRYPTION_KEY` to pin it.

Local mode is the same app the hosted deployments serve, with different defaults,
not a reduced build. A bug you find here is a bug in production.
