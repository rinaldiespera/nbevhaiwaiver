export function slugify(input: string): string {
  const s = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return s || "waiver";
}

export function slugCollision(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  return `${base}-${attempt}`;
}
