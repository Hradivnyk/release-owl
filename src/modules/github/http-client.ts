export interface HttpGetOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface IHttpClient {
  get(
    url: string,
    headers: HeadersInit,
    options?: HttpGetOptions,
  ): Promise<Response>;
}

export class FetchHttpClient implements IHttpClient {
  async get(
    url: string,
    headers: HeadersInit,
    options?: HttpGetOptions,
  ): Promise<Response> {
    const controller = new AbortController();

    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      } else {
        options.signal.addEventListener(
          'abort',
          () => controller.abort(options.signal!.reason),
          { once: true },
        );
      }
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (options?.timeoutMs !== undefined) {
      timeoutId = setTimeout(
        () =>
          controller.abort(
            new DOMException('Request timed out', 'TimeoutError'),
          ),
        options.timeoutMs,
      );
    }

    try {
      return await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
