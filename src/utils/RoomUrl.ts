export function roomUrl(href: string, seed: number): string {
  const url = new URL(href);
  url.searchParams.set('room', String(seed));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function replaceRoomInAddress(seed: number): void {
  window.history.replaceState(window.history.state, '', roomUrl(window.location.href, seed));
}
