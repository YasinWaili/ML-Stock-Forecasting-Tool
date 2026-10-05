"use client";
import { memo, useMemo } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartPoint } from "../types";
type Props = {
  points: ChartPoint[];
  currency: string;
  showSma: boolean;
  showBands: boolean;
  showVolume: boolean;
  theme: "dark" | "light";
};
const shortDate = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
  });

export const PriceChart = memo(function PriceChart({
  points,
  currency,
  showSma,
  showBands,
  showVolume,
  theme,
}: Props) {
  const money = useMemo(
    () =>
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
        maximumFractionDigits: 2,
      }),
    [currency],
  );
  const bounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const point of points) {
      const values = [
        point.close,
        ...(showSma ? [point.sma20, point.sma50] : []),
        ...(showBands ? [point.upper_band, point.lower_band] : []),
      ];
      for (const value of values)
        if (value != null && Number.isFinite(value)) {
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
    }
    if (!Number.isFinite(min)) return [0, 1];
    const pad = Math.max((max - min) * 0.1, max * 0.01);
    return [min - pad, max + pad];
  }, [points, showSma, showBands]);
  const color = theme === "dark" ? "#a7a3ff" : "#5b50bb";
  const grid = theme === "dark" ? "#2b2e36" : "#e4e4e9";
  const text = theme === "dark" ? "#9296a2" : "#727782";
  const tooltipStyle = {
    background: theme === "dark" ? "#21242c" : "#fff",
    border: `1px solid ${grid}`,
    borderRadius: 6,
    color: theme === "dark" ? "#fff" : "#20212a",
    fontSize: 12,
  };
  return (
    <div className="price-chart" aria-label="Daily closing price chart">
      <ResponsiveContainer width="100%" height={320} minWidth={0}>
        <ComposedChart
          data={points}
          margin={{ top: 12, right: 8, bottom: 4, left: 8 }}
          syncId="stock-history"
          accessibilityLayer
        >
          <defs>
            <linearGradient id="price-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.14} />
              <stop offset="100%" stopColor={color} stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={grid} strokeDasharray="3 5" />
          <XAxis dataKey="date" hide />
          <YAxis
            orientation="right"
            domain={bounds}
            width={62}
            tickLine={false}
            axisLine={false}
            tick={{ fill: text, fontSize: 12 }}
            tickFormatter={(value: number) =>
              value.toLocaleString("en", { maximumFractionDigits: 1 })
            }
            tickCount={5}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(label) => shortDate(String(label))}
            formatter={(value, name) => [
              money.format(Number(value)),
              String(name),
            ]}
            cursor={{ stroke: text, strokeDasharray: "3 3" }}
          />
          <Area
            type="linear"
            dataKey="close"
            name="Close"
            stroke={color}
            fill="url(#price-fill)"
            strokeWidth={2}
            isAnimationActive={false}
            activeDot={{ r: 4, strokeWidth: 2, fill: color }}
          />
          {showSma && (
            <>
              <Line
                type="linear"
                dataKey="sma20"
                name="20-day average"
                stroke="#2a9b87"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="sma50"
                name="50-day average"
                stroke="#c49a4b"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </>
          )}
          {showBands && (
            <>
              <Line
                type="linear"
                dataKey="upper_band"
                name="Upper band"
                stroke={text}
                strokeDasharray="4 4"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="linear"
                dataKey="lower_band"
                name="Lower band"
                stroke={text}
                strokeDasharray="4 4"
                strokeWidth={1}
                dot={false}
                isAnimationActive={false}
              />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {showVolume ? (
        <div className="volume-chart">
          <span>Volume</span>
          <ResponsiveContainer width="100%" height={80} minWidth={0}>
            <ComposedChart
              data={points}
              margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
              syncId="stock-history"
              accessibilityLayer
            >
              <XAxis
                dataKey="date"
                tickFormatter={shortDate}
                minTickGap={70}
                tick={{ fill: text, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide domain={[0, "dataMax"]} />
              <YAxis
                yAxisId="spacing"
                orientation="right"
                width={62}
                tick={false}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(label) => shortDate(String(label))}
                formatter={(value) => [
                  Number(value).toLocaleString("en"),
                  "Volume",
                ]}
              />
              <Bar dataKey="volume" fill={grid} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="date-axis">
          <span>{shortDate(points[0]?.date || "2000-01-01")}</span>
          <span>{shortDate(points.at(-1)?.date || "2000-01-01")}</span>
        </div>
      )}
    </div>
  );
});
