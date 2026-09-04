"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DailyTrendPoint } from "@/lib/dashboard-stats";
import { CHART_AXIS_COLOR as AXIS_COLOR, CHART_GRIDLINE_COLOR as GRIDLINE_COLOR, CHART_SEQUENTIAL_COLOR as TREND_COLOR } from "./chart-colors";

export function TrendChart({ data }: { data: DailyTrendPoint[] }) {
  const hasData = data.some((d) => d.count > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tren Pengajuan Bulan Ini</CardTitle>
      </CardHeader>
      <CardContent className="pl-0">
        {hasData ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRIDLINE_COLOR} />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={{ stroke: AXIS_COLOR }}
                tick={{ fontSize: 11, fill: AXIS_COLOR }}
                interval={4}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: AXIS_COLOR }}
                width={28}
              />
              <Tooltip
                cursor={{ fill: "rgba(42,120,214,0.08)" }}
                formatter={(value) => [`${value} pengajuan`, ""]}
                labelFormatter={(day) => `Tanggal ${day}`}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="count" fill={TREND_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="pl-6 text-sm text-muted-foreground">Belum ada pengajuan bulan ini.</p>
        )}
      </CardContent>
    </Card>
  );
}
