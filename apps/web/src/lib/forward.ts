/** Where an old address now lives, with its query (`?id=…`) carried over. */
export function forwardTarget(to: string, search: string): string {
  return `${to}${search}`;
}
