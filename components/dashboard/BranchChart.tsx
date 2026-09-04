"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BreakdownSlice } from "@/lib/dashboard-stats";
import { CHART_AXIS_COLOR as AXIS_COLOR, CHART_GRIDLINE_COLOR as GRIDLINE_COLOR, CHART_SEQUENTIAL_COLOR as BRANCH_COLOR } from "./chart-colors";

export function BranchChart({ slices }: { slices: BreakdownSlice[] }) {
  const data = slices.map((s) => ({ branch: s.key, count: s.count })).sort((a, b) => a.branch.localeCompare(b.branch));
  const hasData = data.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pengajuan per Cabang Bulan Ini</CardTitle>
      </CardHeader>
      <CardContent className="pl-0">
        {hasData ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke={GRIDLINE_COLOR} />
              <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={{ stroke: AXIS_COLOR }} tick={{ fontSize: 11, fill: AXIS_COLOR }} />
              <YAxis dataKey="branch" type="category" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: AXIS_COLOR }} width={40} />
              <Tooltip
                cursor={{ fill: "rgba(42,120,214,0.08)" }}
                formatter={(value) => [`${value} pengajuan`, ""]}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Bar dataKey="count" fill={BRANCH_COLOR} radius={[0, 4, 4, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="pl-6 text-sm text-muted-foreground">Belum ada data bulan ini.</p>
        )}
      </CardContent>
    </Card>
  );
}
