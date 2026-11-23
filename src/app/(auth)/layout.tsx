// Layout provisional de autenticación (el diseño final llega en el checkpoint 14).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div>
          <p className="text-2xl font-semibold">LEAT</p>
          <p className="text-sm opacity-70">Leak &amp; Exposure Assessment Tool</p>
        </div>
        {children}
      </div>
    </main>
  );
}
