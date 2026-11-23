/** Layout de autenticación: tarjeta centrada con la marca en cian. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="text-center">
          <p className="text-3xl font-semibold tracking-wider text-accent">LEAT</p>
          <p className="mt-1 text-sm text-fg-muted">Leak &amp; Exposure Assessment Tool</p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6">{children}</div>
      </div>
    </main>
  );
}
