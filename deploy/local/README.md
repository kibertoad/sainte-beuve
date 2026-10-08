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
  a local cat-factory serves. Add an API key with the `decide` scope and a service
  id, and the "AI review" button starts filing real review tasks: expand the board
  row to read what came back, tick the findings worth a comment and post them.
  Point the URL at the centralized instance instead and nothing else changes: it is
  the same client either way.
- **GitHub**: a personal access token is enough locally, and so is signing in with
  GitHub if you register an OAuth app with the loopback callback. Assignments then
  mirror onto the real pull request and the bot can comment on it. Whichever
  credential you set is also who the workspace renders for, because there are
  no sessions yet.
  The shortest of those is the token the GitHub CLI already holds, see
  [GitHub from the CLI](#github-from-the-cli).
- **GitLab**: a personal access token, or an OAuth application whose callback is
  `http://localhost:8788/connect/gitlab/callback`. Set `GITLAB_BASE_URL` for a
  self-managed install; it configures the API and the OAuth endpoints together.
- **Slack**: a bot token and a channel id, and the reminder clock (every 15s in local
  mode, rather than hourly) delivers to a real channel.

## GitHub from the CLI

```bash
gh auth login              # once, through the browser
pnpm setup:local:github    # writes GITHUB_TOKEN into deploy/local/.env
```

The script runs `gh auth token` and writes the result into `deploy/local/.env`,
creating the file from `.env.example` if it is missing and replacing only the
`GITHUB_TOKEN` line otherwise. The token never reaches the terminal, the shell
history or a command line. Restart `pnpm dev:local` afterwards. Run it again
whenever gh's token changes, for instance after `gh auth refresh`.

This reuses the credential gh already holds instead of minting a new one. It is
scoped to you and revoked by `gh auth logout`, which makes it a better local
default than a long-lived PAT created for the purpose. Treat it as a full secret
all the same: it carries every scope your gh login has (`gh auth status` lists
them).

### What your token is

The prefix says where a token came from, and the script checks it:

| Prefix        | What it is                                                       |
| ------------- | ---------------------------------------------------------------- |
| `gho_`        | gh's own OAuth token, from the browser login. The expected case. |
| `ghp_`        | A classic PAT that was pasted into `gh auth login --with-token`. |
| `github_pat_` | A fine-grained PAT, pasted the same way.                         |

The two PAT prefixes work, and the script writes them with a warning: the token
is then a separately minted, long-lived credential, with whatever scopes and
expiry it was created with. Run `gh auth logout` and `gh auth login` through the
browser to get a `gho_` token instead. Anything else is not a GitHub user token
and the script writes nothing. A `GH_TOKEN` or `GITHUB_TOKEN` variable in your
shell takes precedence over gh's stored login, so check those first when the
prefix surprises you.

## Inbound deliveries

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
key at boot. It is ephemeral on purpose, because the store behind it empties on a
restart too, so a token entered in the SPA does not survive one either way. Set
`SETTINGS_ENCRYPTION_KEY` to pin it, which is what a local run against a real
database needs: credentials sealed under a key that is gone are credentials nobody
can read.

The board lives in memory here, which is why nothing has to be installed to try the
product. Local mode is the Node stack, so `DATABASE_URL` makes it durable and applies
the schema at boot, the same way the hosted deployment does; `/health` reports which
store is in force.

Local mode is the same app the hosted deployments serve, with different defaults,
not a reduced build. A bug you find here is a bug in production.
