"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { TrendPoint } from "@/lib/dashboard/metrics";

/**
 * Tendencia diaria: hallazgos detectados (primera detección o reapertura) y
 * resueltos. Dos series en un solo eje; texto en tokens de texto, nunca en el
 * color de la serie. Incluye tabla equivalente para lectores de pantalla.
 */

// Mismos valores que --color-chart-* (en SVG se usan literales).
const SERIES = [
  { key: "detected", label: "Detectados", color: "#0ea5c6" },
  { key: "resolved", label: "Resueltos", color: "#9d4edd" },
] as const;

const AXIS = { fill: "#808c9b", fontSize: 11 };
const shortDate = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });

function formatDay(day: string): string {
  return shortDate.format(new Date(`${day}T00:00:00Z`));
}

function TrendTooltip({ active, payload, label }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-fg">{formatDay(String(label))}</p>
      {SERIES.map((s) => {
        const item = payload.find((p) => p.dataKey === s.key);
        return (
          <p key={s.key} className="flex items-center gap-2 text-fg-muted">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ background: s.color }} />
            {s.label}
            <span className="ml-auto pl-4 font-medium text-fg tabular-nums">{Number(item?.value ?? 0)}</span>
          </p>
        );
      })}
    </div>
  );
}

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const totals = SERIES.map((s) => ({ ...s, total: data.reduce((n, p) => n + p[s.key], 0) }));

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-4 text-xs text-fg-muted" aria-label="Leyenda">
        {totals.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span aria-hidden="true" className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
            {s.label}
            <span className="font-medium text-fg tabular-nums">{s.total}</span>
          </li>
        ))}
      </ul>

      <div className="h-56" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }}>
            <CartesianGrid vertical={false} stroke="#243041" />
            <XAxis
              dataKey="day"
              tickFormatter={formatDay}
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: "#243041" }}
              minTickGap={24}
            />
            <YAxis allowDecimals={false} tick={AXIS} tickLine={false} axisLine={false} width={48} />
            <Tooltip content={TrendTooltip} cursor={{ stroke: "#33425a", strokeWidth: 1 }} />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: "#111821", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <details className="text-xs text-fg-muted">
        <summary className="cursor-pointer text-fg-subtle hover:text-fg-muted">Ver como tabla</summary>
        <table className="mt-2 w-full max-w-sm">
          <thead>
            <tr className="text-left text-fg-subtle">
              <th className="py-1 font-normal">Día</th>
              <th className="py-1 font-normal">Detectados</th>
              <th className="py-1 font-normal">Resueltos</th>
            </tr>
          </thead>
          <tbody>
            {data
              .filter((p) => p.detected > 0 || p.resolved > 0)
              .map((p) => (
                <tr key={p.day} className="border-t border-line">
                  <td className="py-1">{formatDay(p.day)}</td>
                  <td className="py-1 tabular-nums">{p.detected}</td>
                  <td className="py-1 tabular-nums">{p.resolved}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
