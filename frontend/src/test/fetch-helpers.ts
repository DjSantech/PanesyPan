/** URL de una llamada a fetch, venga como texto, URL o Request. */
export function requestUrl(input: RequestInfo | URL | undefined): string {
  if (input === undefined) return '';
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Cuerpo JSON enviado en una llamada a fetch. */
export function requestJson(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
}
