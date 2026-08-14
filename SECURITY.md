# Security policy

## Reporting a vulnerability

Please report privately rather than in a public issue, using GitHub's
[private vulnerability reporting](https://github.com/DuvInc/duvlify/security/advisories/new)
on this repository. That opens a channel visible only to you and the maintainer.

This is a one-person project. You should get an acknowledgement within a few days;
if a week passes with no reply, feel free to nudge by opening a public issue that
says only that you are waiting on a private report, no details.

Please include what an attacker can do, not only what looks wrong: the affected
version or commit, the configuration that exposes it, and the smallest
reproduction you have.

## What is in scope

Duvlify builds a static site and, optionally, deploys a Worker in front of it. The
interesting surface is small and worth naming:

- **The agent surfaces**: `/mcp`, `/api/docs/*`, and the WebMCP bridge. Anything
  that lets a caller read something the site does not publish, exceed the rate
  limits, or make the Worker act as a proxy.
- **The build**: anything in `content/` or an OpenAPI document that can inject
  script into a rendered page, or escape a `style` attribute into a second
  declaration. `src/lib/css-value.ts` exists for that second case, and
  `src/lib/spec-markdown.ts` for prose arriving from a spec.
- **Publication rules**: anything that makes a `draft` or `noindex` page reach an
  output it should not. That is a correctness bug with a confidentiality
  consequence, and it is treated as a security issue.
- **Secret handling**: anything that puts `AI_SEARCH_TOKEN` or
  `CLOUDFLARE_ACCOUNT_ID` into the built output. Neither should ever reach the
  Worker bundle.

## What is not in scope

- **`agents.feedback.webhook`.** It is read at build time and compiled into the
  bundle, so it is served to anyone who asks. That is documented rather than
  fixed: use a receiver that authenticates some other way, and do not put a token
  in the URL.
- **A site's own misconfiguration**: a committed `.env`, a public bucket, a WAF
  rule that was never added. The repository documents what to set; it cannot
  enforce it.
- **Rate limits as a quota.** The Workers rate limiting binding counts per
  datacenter and is eventually consistent by design, so a distributed client gets
  a multiple of the configured numbers. It is an abuse damper. The real ceiling is
  a WAF rule on the zone, and the documentation says so.
- **Denial of service by volume** against a deployment you control.

## Supported versions

Pre-1.0, only the `main` branch is supported. There are no backports; a fix lands
on `main` and is released from there.

## If you are running your own site on this framework

This file describes the upstream project, and it arrived in your repository with
the code. Replace it. The reporting link above opens an advisory on *this*
repository, so anyone who finds a vulnerability in your deployment and follows it
reports to the wrong maintainer. A report about your content, your
configuration, or your Worker secrets is not upstream's to receive.

Keep the two lists above as a starting point for your own threat model; they
describe the framework, which you are still running. Add whatever your deployment
adds.
