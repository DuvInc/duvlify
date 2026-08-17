/**
 * The agent-access dialog: opening, closing, and its copy buttons.
 *
 * Separate from search.ts even though both drive a `<dialog>`, because the two
 * share no state and search carries an index fetch, keyboard navigation and
 * result rendering that this has no use for. What they do share — the element,
 * the backdrop, `showModal()` — is the platform's, not ours.
 */
import { $, $$, confirmCopy, copyText, on } from './dom';

/** `onOpen` closes the page menu, one of the two places a trigger lives. */
export function initAgentAccess(onOpen: () => void) {
  const dialog = $<HTMLDialogElement>('[data-agent-dialog]');
  /* Absent when `agents.enabled` is false: the component does not render, and
     neither does its trigger. Nothing to bind, and no error worth raising. */
  if (!dialog) return;

  const close = () => dialog.close();

  $$('[data-agent-open]').forEach(trigger =>
    trigger.addEventListener('click', () => {
      /* Opening from the page menu would otherwise leave it expanded behind the
         dialog, and visible again on close. */
      onOpen();
      dialog.showModal();
    }),
  );

  on('[data-agent-close]', 'click', close);

  /*
   * Clicking the backdrop closes. `<dialog>` reports backdrop clicks as clicks
   * on the dialog itself, so the test is geometric: a click outside the
   * element's own box is a click on the backdrop. Comparing against
   * `event.target` alone would also close on clicks landing in the padding
   * between sections.
   */
  dialog.addEventListener('click', event => {
    const box = dialog.getBoundingClientRect();
    const outside =
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom;
    /* A synthesised click (keyboard activation) reports 0,0 and would read as
       outside every box on the page. */
    if (outside && event.detail > 0) close();
  });

  on('[data-agent-copy]', 'click', async button => {
    await copyText(button.dataset.agentCopy ?? '');
    confirmCopy(button);
  });
}
