/** Compile permanent page moves once. Never accept an external destination. */
export function createRedirectResolver(moves: Readonly<Record<string, string>>, basePath: string) {
  for (const [from, to] of Object.entries(moves)) {
    for (const path of [from, to]) {
      if (!path.startsWith('/') || path.startsWith('//') || /[?#\\]/.test(path)
        || (path !== '/' && path.endsWith('/')) || path.endsWith('.md')
        || new URL(path, 'https://redirect.invalid').pathname !== path) {
        throw new Error(`Invalid redirect path "${path}". Use a page path without a base, query, trailing slash or .md.`);
      }
    }
    if (from === to || Object.hasOwn(moves, to)) {
      throw new Error(`Redirect "${from}" must point directly to its final page, not "${to}".`);
    }
  }

  return (path: string, search = ''): string | null => {
    const markdown = path.endsWith('.md');
    const bare = (markdown ? path.slice(0, -3) : path).replace(/\/+$/, '') || '/';
    const directory = markdown && bare.endsWith('/index') ? bare.slice(0, -6) || '/' : bare;
    const target = Object.hasOwn(moves, bare) ? moves[bare]
      : Object.hasOwn(moves, directory) ? moves[directory] : undefined;
    if (target === undefined) return null;
    const destination = target === '/' ? (markdown ? '/index.md' : '/') : `${target}${markdown ? '.md' : ''}`;
    return `${basePath}${destination}${search}`;
  };
}
