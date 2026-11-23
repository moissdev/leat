/** Score de 0 a 100 en morado (evaluación), con barra sólida. */
export function ScoreMeter({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  return (
    <div className="flex flex-col gap-1.5" aria-label={`Score ${value} de 100`}>
      <p className={size === "md" ? "text-3xl font-semibold text-assess-fg" : "text-lg font-semibold text-assess-fg"}>
        {value}
        <span className="text-xs font-normal text-fg-subtle">/100</span>
      </p>
      <div className="h-1.5 rounded-full bg-track">
        <div className="h-1.5 rounded-full bg-assess" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
