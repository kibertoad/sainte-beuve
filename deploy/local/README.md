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

## Attaching the real things, one at a time

Copy `.env.example` to `.env` and fill in only the block you care about.

- **cat-factory**: `CAT_FACTORY_BASE_URL` defaults to `http://localhost:8787`, where
  a local cat-factory serves. Add an API key and a service id and the "AI review"
  button starts filing real review tasks. Point the URL at the centralized instance
  instead and nothing else changes: it is the same client either way.
- **GitHub**: a personal access token is enough locally. Assignments then mirror onto
  the real pull request.
- **Slack**: a bot token and a channel id, and the reminder clock (every 15s in local
  mode, rather than hourly) delivers to a real channel.

Local mode is the same app the hosted deployments serve, with different defaults,
not a reduced build. A bug you find here is a bug in production.
