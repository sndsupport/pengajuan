"use client";

import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BreakdownSlice } from "@/lib/dashboard-stats";

export type BreakdownDonutProps = {
  title: string;
  slices: BreakdownSlice[];
  labelFor: (key: string) => string;
  colorFor: (key: string) => string;
};

export function BreakdownDonut({ title, slices, labelFor, colorFor }: BreakdownDonutProps) {
  const total = slices.reduce((sum, s) => sum + s.count, 0);
  const data = slices.map((s) => ({ name: labelFor(s.key), key: s.key, value: s.count }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {total > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius={50}
                outerRadius={75}
                paddingAngle={2}
                stroke="#fcfcfb"
                strokeWidth={2}
              >
                {data.map((d) => (
                  <Cell key={d.key} fill={colorFor(d.key)} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, name) => [`${value} pengajuan`, name]}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted-foreground">Belum ada data bulan ini.</p>
        )}
      </CardContent>
    </Card>
  );
}
