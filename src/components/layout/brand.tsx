import Link from "next/link";

/** Marca de LEAT: el acrónimo en cian (decisión de diseño del checkpoint 14). */
export function Brand() {
  return (
    <Link href="/dashboard" className="block px-3">
      <span className="block text-2xl font-semibold tracking-wider text-accent">LEAT</span>
      <span className="block text-xs text-fg-subtle">Leak &amp; Exposure Assessment</span>
    </Link>
  );
}
