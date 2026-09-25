/** Treat punctuation, word order and ё/е consistently across all search boxes. */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/[«»„“”"'’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + Number(i < a.length || j < b.length) <= 1;
}
export function matchesSearch(value: string, query: string): boolean {
  const haystack = normalizeSearch(value);
  const words = haystack.split(" ");
  return normalizeSearch(query)
    .split(" ")
    .filter(Boolean)
    .every(
      (token) =>
        haystack.includes(token) ||
        (token.length >= 4 &&
          !/\d/.test(token) &&
          words.some((word) => oneEdit(token, word))),
    );
}
