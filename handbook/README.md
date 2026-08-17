# The framework's manual

These pages describe **the framework**, not this site's content: how to
configure it, write pages, deploy it, and serve AI agents.

They exist so that this folder survives the step every fork is told to take.
[`README.md`](../README.md) says to replace `content/` with your own pages, and
`content/` is where this documentation is published from. Without a copy here, a
fork loses every explanation of how the thing it forked works, and the README's
own links point at duvlify.dev — a host you do not control, describing a version
you have not forked.

Nothing here is published. The site is built from `content/` into `dist/`, and
`dist/` is what gets deployed, so these files never reach a visitor.

## If this is your own documentation repository

This folder is frozen, and it stays correct whatever you do to `content/`. That
is the whole reason it exists.

**Do not run `npm run manual:snapshot`.** That command regenerates this folder
from whatever `content/` currently holds — in your repository, your own pages —
and deletes the files that no longer match. The manual you are reading would be
what it deleted. The script refuses when it can tell that this has happened, but
the protection you should rely on is not asking it to.

`npm run manual:check`, which CI runs, is safe: it writes nothing, and it exits
quietly once it sees that this folder describes a different documentation set
than your build.

Delete the folder when you no longer need it. Nothing reads it — no build step,
no test, no route — and the check passes on its absence.

## If you maintain the framework itself

Each file is a copy of the Markdown that page serves at `<page>.md`, taken by
[`scripts/snapshot-manual.mjs`](../scripts/snapshot-manual.mjs). They are the
exact bytes the build already generates and the test suite already checks, so
there is no second copy of the prose to keep in step.

They update only when the script runs:

```bash
npm run manual:snapshot
```

That is deliberate. A fork keeps the manual for the commit it forked, rather
than tracking a site that keeps moving. Re-run the script after editing
`content/`, and before cutting a release.

The live version of these pages, always current, is at
[duvlify.dev](https://duvlify.dev).

## Contents

### Guides

- [Getting started](./getting-started.md)
- [Authoring pages](./guides/authoring.md)
- [API reference pages](./guides/api-reference.md)
- [Deploying](./guides/deployment.md)
- [Publishing in several languages](./guides/internationalization.md)

### Reference

- [Frontmatter](./reference/frontmatter.md)
- [Components](./reference/components.md)
- [Code and diagrams](./reference/code-and-diagrams.md)
- [Page layouts](./reference/page-layouts.md)
- [Configuration](./reference/configuration.md)
- [Theming](./reference/theming.md)
- [How the build works](./reference/architecture.md)

### Agents

- [Serving agents](./agents/overview.md)
- [The manifest, WebMCP and limits](./agents/mcp.md)
- [Retrieval](./agents/retrieval.md)
- [Discoverability](./agents/discovery.md)
