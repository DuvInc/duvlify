/**
 * Renders a description taken from the OpenAPI document.
 *
 * OpenAPI says every `description` is CommonMark, and real specifications use
 * it: `` `starting_after` ``, **bold**, a link to another operation. Rendered as
 * plain text those come out as literal backticks and asterisks, which reads as
 * a bug in the documentation rather than as a formatting choice in the spec —
 * and it is the one place on an endpoint page where prose is *not* authored in
 * MDX, so nothing else was rendering it.
 *
 * Uses Astro's own Markdown processor rather than a hand-rolled inline renderer,
 * so a description is formatted by exactly the same rules as page prose, and
 * multi-paragraph descriptions keep their paragraphs.
 *
 * The output is inserted with `set:html`. The document lives in
 * src/openapi.config.ts — a committed source file, the same trust level as the
 * MDX under content/, which may also contain raw HTML. A specification fetched
 * from somewhere else at build time would not qualify, and would need
 * sanitising here first.
 */
import { createMarkdownProcessor } from '@astrojs/markdown-remark';

/* One processor for the whole build: creating it parses and assembles the
   plugin chain, and a page can hold dozens of described fields. */
let processor: Awaited<ReturnType<typeof createMarkdownProcessor>> | undefined;

export async function renderSpecMarkdown(text: string | undefined): Promise<string | undefined> {
  if (!text) return undefined;
  processor ??= await createMarkdownProcessor({ gfm: true, smartypants: false });
  const { code } = await processor.render(text);
  return code;
}
