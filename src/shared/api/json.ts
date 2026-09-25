/** A frontend fallback can return HTML with status 200 when an API is misconfigured. */
export async function readApiJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (
    response.headers.get("content-type")?.includes("text/html") ||
    /^\s*</.test(body)
  )
    throw new Error(
      "Вместо данных API вернулась страница сайта. Проверьте адрес API и запуск сервера; затем повторите обновление.",
    );
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(
      "Сервис вернул некорректный ответ. Повторите обновление или проверьте подключение API.",
    );
  }
}
