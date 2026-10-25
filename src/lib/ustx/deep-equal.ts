/**
 * YAML から得た素の値（オブジェクト・配列・プリミティブ）同士を比較する。
 * 一致すれば null、異なれば最初に食い違ったパスを返す。
 */
export function isDeepStrictEqual(
  a: unknown,
  b: unknown,
  path = "$",
): string | null {
  if (Object.is(a, b)) return null;
  if (
    typeof a !== typeof b ||
    a === null ||
    b === null ||
    typeof a !== "object"
  )
    return path;
  if (Array.isArray(a) !== Array.isArray(b)) return path;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}.length`;
    for (let i = 0; i < a.length; i++) {
      const diff = isDeepStrictEqual(a[i], b[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return `${path}(キー数)`;
  for (const key of keys) {
    if (!Object.hasOwn(bo, key)) return `${path}.${key}`;
    const diff = isDeepStrictEqual(ao[key], bo[key], `${path}.${key}`);
    if (diff) return diff;
  }
  return null;
}
