# Contributing to Duvlify

Thanks for looking. This is a one-person project maintained on a best-effort
basis, so the most useful thing you can do before writing code is open an issue
or a [discussion](https://github.com/DuvInc/duvlify/discussions). A small fix is
always welcome, and a large one is worth agreeing on first.

## Getting set up

Node 22.12 or newer, the floor Astro sets. `.nvmrc` pins the major, so `nvm use`
gets you the same version CI runs.

```bash
npm install
npm run dev       # http://localhost:4321
npm test          # a real build, then assertions against it and a real Worker
```

`npm test` builds the site, asserts the publication rules across every output,
and boots a Worker to exercise the MCP and HTTP surfaces over the network. It
should pass on a fresh clone. If it does not, that is a bug worth reporting on its
own.

## Sign your commits off

Every commit needs a `Signed-off-by` line, which certifies that you wrote the
patch or otherwise have the right to submit it under the MIT licence. This is the
[Developer Certificate of Origin](https://developercertificate.org): one line,
no paperwork, no copyright assignment:

```bash
git commit -s -m "Your message"
```

The sign-off is what keeps the licence unambiguous as soon as more than one person
has contributed. Pull requests without it will be asked for an amend.

## What makes a change likely to be merged

**Configuration belongs in `src/docs.config.ts`.** If a site has to edit a
component, a stylesheet or the Worker to change a string, a colour or a
behaviour, that is a gap in the config surface. Fixing it there is better than
documenting the workaround.

**One join, one source.** A page declares what it is; the config declares where it
sits; `src/lib/navigation.ts` joins them and everything else reads that one
resolved tree. Publication is decided in `src/lib/published.ts` and nowhere else.
Adding a second place that answers either question is the failure mode this
codebase is arranged to avoid.

**Mismatches should fail the build.** A typo'd page id, a published page in no
sidebar group, a frontmatter field that is too long: these are errors that name
the file, not warnings. Prefer failing loudly at build time over degrading
quietly at runtime.

**Comments explain why, not what.** The existing ones are long on purpose: they
record the reasoning and, where it matters, the thing that went wrong before.
Match that register. A comment restating the line below it is noise; a comment
explaining why the obvious approach was not taken is the most valuable thing in
the file.

**Measure contrast against the tints.** If you touch a colour, check it against
the accent tints as well as the page background, in both modes. The page
background is the easy case and the one a colour picker shows you.

`test/agents.test.mjs` boots a real Worker on port 8791. If something else is
already listening there (another project's `wrangler dev` is the usual culprit,
since they all pick from the same small range), every suite in that file fails
with a 60 second timeout. The error says so and names the port. Run it elsewhere
with `AGENT_TEST_PORT=8892 npm test`.

## Changes that need a conversation first

- A new dependency. The bundle ships to every reader of every site built on this.
- A new configuration field. There may already be a way to express it.
- Anything that changes a published URL, an output file, or the shape of an agent
  response: those are contracts that other people's sites and other people's
  agents depend on.
- A new component. The vocabulary is deliberately finite.

## Documentation lives in `content/`

The site at [duvlify.dev](https://duvlify.dev) is built from this repository's
`content/` folder, so a change in behaviour and the documentation of it belong in
the same pull request. There is no separate docs site to update afterwards.

`content/reference/components.mdx` is both the component reference and the live
demo, and `test/components.test.mjs` asserts against the page it builds. If you
add a component, add it there.

`handbook/` is a committed snapshot of those same pages as plain Markdown, so
that the manual survives a fork replacing `content/`. It is generated, never
edited by hand:

```bash
SITE_URL=https://duvlify.dev npm run manual:snapshot
```

Run it in any pull request that touches `content/`, and commit the result. CI
runs `npm run manual:check` and fails if the two have drifted, so a stale
snapshot is caught rather than merged. Editing a file under `handbook/` directly
is always wrong: the next snapshot overwrites it.

The script refuses to write when `handbook/` and the build describe different
documentation sets, the guard that stops a site built on this framework from
overwriting its own copy of the manual. Restructuring `content/` far enough to
trip it upstream is legitimate but rare; read the refusal, confirm it is
describing your restructure and not a mistake, then re-run with `-- --force`.

## Reporting a bug

Include the version or commit, what you expected, what happened, and the smallest
`content/` and `src/docs.config.ts` that reproduces it. A build error message with
the file it named is usually enough.

For anything with security implications, please read [SECURITY.md](./SECURITY.md)
instead of opening a public issue.

## Licence

By contributing you agree that your work is licensed under the
[MIT Licence](./LICENSE), the same terms as the rest of the project.
