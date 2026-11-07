/**
 * The text inside a fixed-width method chip (sidebar, search results). DELETE is
 * the one method too long for the 34px chip, so it is shortened there. The page's
 * own endpoint row has room and shows the full name.
 */
export const methodChipLabel = (method: string): string => {
  const upper = method.toUpperCase();
  return upper === 'DELETE' ? 'DEL' : upper;
};
