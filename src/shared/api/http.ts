import { readApiJson } from "./json";
import { config } from "../config/env";
export async function request<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const target = new URL(
    url.replace("/api/v1", config.apiUrl),
    globalThis.location?.origin || "http://localhost:5173",
  );
  const response = await fetch(target, { credentials: "include", ...options });
  if (!response.ok)
    throw new Error(`Не удалось загрузить данные (${response.status})`);
  return {
    data: await readApiJson(response),
    status: response.status,
    headers: response.headers,
  } as T;
}
