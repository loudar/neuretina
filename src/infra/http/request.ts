import { ProviderError } from "../../core/errors.ts";

export async function requestRaw(
  provider: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new ProviderError(provider, `network request failed: ${url}`, { cause: error });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ProviderError(provider, `HTTP ${response.status} for ${url}`, {
      status: response.status,
      details: { body: body.slice(0, 600) },
    });
  }

  return response;
}

export async function requestJson<T>(
  provider: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await requestRaw(provider, url, init);
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new ProviderError(provider, `invalid JSON response from ${url}`, { cause: error });
  }
}
