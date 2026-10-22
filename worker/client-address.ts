/** Group IPv6 addresses by subscriber network so rotation cannot reset a limit. */
export function addressKey(ip: string | null | undefined): string {
  const value = ip?.trim().toLowerCase();
  if (!value) return 'unknown';
  if (!value.includes(':')) return value;

  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped) return mapped[1];

  const [head, tail] = value.split('::', 2);
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = tail === undefined
    ? left
    : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  const prefix = groups.slice(0, 4).map(group => Number.parseInt(group, 16));
  if (prefix.length < 4 || prefix.some(group => Number.isNaN(group))) return value;
  return `${prefix.map(group => group.toString(16)).join(':')}::/64`;
}
