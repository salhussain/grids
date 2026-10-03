import { useState } from 'react';
import { cx } from './components';

export interface Bar {
  key: string;
  label: string;
  value: number;
}

/**
 * Single-series vertical bar chart (inline SVG). One hue (accent, validated
 * against light/dark surfaces), square bar ends per the console's sharp style,
 * 2px gaps, recessive grid, per-bar hover tooltip, and a table view toggle.
 */
export function BarChart({
  data,
  format,
  height = 220,
  title,
}: {
  data: Bar[];
  format: (v: number) => string;
  height?: number;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const W = 720;
  const padL = 64;
  const padB = 28;
  const plotW = W - padL - 8;
  const plotH = height - padB - 8;
  const slot = plotW / Math.max(data.length, 1);
  const barW = Math.max(4, Math.min(48, slot - 2));

  return (
    <figure>
      <div className="mb-3 flex items-center justify-between">
        <figcaption className="text-xs text-zinc-500">{title}</figcaption>
        <div className="flex border border-zinc-300 text-xs">
          {['Chart', 'Table'].map((m) => (
            <button
              key={m}
              onClick={() => setAsTable(m === 'Table')}
              className={cx(
                'px-2.5 py-1',
                (m === 'Table') === asTable
                  ? 'bg-ink text-canvas'
                  : 'bg-snow text-zinc-600 hover:bg-zinc-100',
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      {asTable ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-300 text-start text-xs text-zinc-500">
              <th className="py-2 font-medium">Month</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key} className="border-b border-zinc-100">
                <td className="py-2">{d.label}</td>
                <td className="num py-2 text-right">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${height}`}
            className="w-full"
            role="img"
            aria-label={title}
            onMouseLeave={() => setHover(null)}
          >
            {ticks.map((t) => {
              const y = 8 + plotH - (t / max) * plotH;
              return (
                <g key={t}>
                  <line x1={padL} x2={W - 8} y1={y} y2={y} stroke="#e4e4e7" strokeWidth={1} />
                  <text
                    x={padL - 8}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-zinc-500 text-[11px]"
                  >
                    {format(t)}
                  </text>
                </g>
              );
            })}
            {data.map((d, i) => {
              const h = max ? (d.value / max) * plotH : 0;
              const x = padL + i * slot + (slot - barW) / 2;
              return (
                <g key={d.key} onMouseEnter={() => setHover(i)}>
                  {/* hit target bigger than the mark */}
                  <rect x={padL + i * slot} y={8} width={slot} height={plotH} fill="transparent" />
                  <rect
                    x={x}
                    y={8 + plotH - h}
                    width={barW}
                    height={Math.max(h, d.value ? 1 : 0)}
                    className={
                      hover === null || hover === i ? 'fill-accent-600' : 'fill-accent-600/35'
                    }
                  />
                  <text
                    x={padL + i * slot + slot / 2}
                    y={height - 8}
                    textAnchor="middle"
                    className="fill-zinc-500 text-[11px]"
                  >
                    {d.label}
                  </text>
                </g>
              );
            })}
            <line
              x1={padL}
              x2={W - 8}
              y1={8 + plotH}
              y2={8 + plotH}
              stroke="#a1a1aa"
              strokeWidth={1}
            />
          </svg>
          {hover !== null && data[hover] && (
            <div
              className="pointer-events-none absolute top-0 border border-zinc-900 bg-snow px-3 py-2 text-xs shadow-md"
              style={{
                left: `${((padL + hover * slot + slot / 2) / W) * 100}%`,
                transform: 'translateX(-50%)',
              }}
            >
              <div className="text-zinc-500">{data[hover].label}</div>
              <div className="num font-semibold text-ink">{format(data[hover].value)}</div>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}
