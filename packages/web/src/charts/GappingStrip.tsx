import { useState } from 'react';
import { scaleLinear } from 'd3-scale';
import type { ClubGap } from '../lib/types';
import { useMeasure } from '../lib/useMeasure';

interface GappingStripProps {
  clubs: ClubGap[];
}

const ROW_H = 30;
const MARGIN = { top: 24, right: 24, bottom: 32, left: 110 };

function fmt(n: number | null): string {
  return n == null ? '—' : `${n.toFixed(1)} m`;
}

export default function GappingStrip({ clubs }: GappingStripProps) {
  const [ref, width] = useMeasure<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  // Only clubs with a valid range render a bar.
  const rows = clubs.filter((c) => c.p25 !== null && c.p75 !== null);
  const metric = rows[0]?.metric ?? 'flatCarry';

  if (rows.length === 0) {
    return (
      <div ref={ref} className="chart-host">
        <p className="muted center">No data to plot.</p>
      </div>
    );
  }

  const w = Math.max(width, 320);
  const innerW = w - MARGIN.left - MARGIN.right;
  const innerH = rows.length * ROW_H;
  const h = innerH + MARGIN.top + MARGIN.bottom;

  const maxVal =
    Math.max(
      ...rows.map((c) => c.p75 ?? 0),
      ...rows.map((c) => c.median ?? 0),
      ...rows.map((c) => c.medianTotal ?? 0),
    ) * 1.05;
  const x = scaleLinear().domain([0, maxVal || 1]).range([0, innerW]).nice();
  const ticks = x.ticks(6);

  return (
    <div ref={ref} className="chart-host" style={{ position: 'relative' }}>
      <svg width={w} height={h} role="img" aria-label="Club gapping strip chart">
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {/* vertical gridlines + x axis ticks */}
          {ticks.map((t) => (
            <g key={t} transform={`translate(${x(t)},0)`}>
              <line y1={0} y2={innerH} className="grid-line" />
              <text y={innerH + 18} textAnchor="middle" className="axis-text">
                {t}
              </text>
            </g>
          ))}
          <text
            x={innerW / 2}
            y={innerH + 32}
            textAnchor="middle"
            className="axis-label"
          >
            Distance (m)
          </text>

          {rows.map((c, i) => {
            const cy = i * ROW_H + ROW_H / 2;
            const x0 = x(c.p25 ?? 0);
            const x1 = x(c.p75 ?? 0);
            const xm = x(c.median ?? 0);
            // Roll connector: median carry -> median total. Only meaningful when the bar is
            // carry-based (flatCarry metric); on a Total bar there's no separate roll to show.
            const showRoll =
              metric === 'flatCarry' &&
              c.medianCarry != null &&
              c.medianTotal != null &&
              c.medianTotal > c.medianCarry + 0.5;
            const xCarry = showRoll ? x(c.medianCarry!) : 0;
            const xTotal = showRoll ? x(c.medianTotal!) : 0;
            const roll = showRoll ? c.medianTotal! - c.medianCarry! : 0;
            return (
              <g key={c.clubDisplayName} transform={`translate(0,${cy})`}>
                <text x={-12} y={4} textAnchor="end" className="row-label">
                  {c.clubDisplayName}
                </text>
                {/* carry spread (P25–P75) */}
                <rect
                  x={x0}
                  y={-7}
                  width={Math.max(x1 - x0, 1)}
                  height={14}
                  rx={4}
                  className="strip-bar"
                />
                {/* median carry tick */}
                <line x1={xm} x2={xm} y1={-10} y2={10} className="strip-median" />
                {/* roll: thin connector from median carry to median total + total marker */}
                {showRoll ? (
                  <g>
                    <line x1={xCarry} x2={xTotal} y1={0} y2={0} className="strip-roll-line" />
                    <line x1={xTotal} x2={xTotal} y1={-8} y2={8} className="strip-total" />
                  </g>
                ) : null}
                {/* full-row transparent hover target */}
                <rect
                  x={-MARGIN.left}
                  y={-ROW_H / 2}
                  width={innerW + MARGIN.left}
                  height={ROW_H}
                  fill="transparent"
                  onMouseMove={(e) => {
                    const host = e.currentTarget.ownerSVGElement?.parentElement as HTMLElement | null;
                    const rect = host?.getBoundingClientRect();
                    setHover({
                      i,
                      x: rect ? e.clientX - rect.left : MARGIN.left + xm,
                      y: MARGIN.top + cy,
                    });
                  }}
                  onMouseLeave={() => setHover((hstate) => (hstate?.i === i ? null : hstate))}
                />
              </g>
            );
          })}
        </g>
      </svg>

      {hover ? (
        (() => {
          const c = rows[hover.i];
          const roll =
            c.medianCarry != null && c.medianTotal != null ? c.medianTotal - c.medianCarry : null;
          return (
            <div
              className="strip-tooltip"
              style={{ left: Math.min(hover.x + 12, w - 170), top: Math.max(hover.y - 10, 4) }}
            >
              <div className="tt-club">{c.clubDisplayName}</div>
              <div className="tt-row">
                Median carry: <strong>{fmt(c.medianCarry ?? c.median)}</strong>
              </div>
              <div className="tt-row">
                Carry P25–P75: <strong>{fmt(c.p25)} – {fmt(c.p75)}</strong>
              </div>
              <div className="tt-row">
                Median total: <strong>{fmt(c.medianTotal)}</strong>
              </div>
              {roll != null ? (
                <div className="tt-row tt-when">Roll: <strong>{roll.toFixed(1)} m</strong></div>
              ) : null}
              <div className="tt-row tt-when">
                {c.keptShots} shots{c.excludedShots ? ` · ${c.excludedShots} excluded` : ''}
              </div>
            </div>
          );
        })()
      ) : null}
    </div>
  );
}
