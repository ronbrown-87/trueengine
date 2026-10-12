import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Clock, ShieldCheck, TrendingDown, FileLock2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { attackResilience, latencyBreakdown } from "@/lib/kyc-data";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "System Analytics & Security Evaluation — VeriAuth AI" },
      {
        name: "description",
        content:
          "Spoof acceptance rate, false rejection rate, latency breakdown and deepfake resistance metrics for the eKYC engine.",
      },
      { property: "og:title", content: "System Analytics & Security — VeriAuth AI" },
      {
        property: "og:description",
        content: "Accuracy, anti-spoofing resilience and processing latency for VeriAuth AI.",
      },
    ],
  }),
  component: Analytics,
});

const metrics = [
  { label: "Spoof Acceptance Rate", value: "0.12%", icon: TrendingDown, tone: "text-success" },
  { label: "False Rejection Rate", value: "1.4%", icon: ShieldCheck, tone: "text-primary" },
  { label: "Avg. Verification Time", value: "14.2s", icon: Clock, tone: "text-warning" },
  { label: "Privacy Audit Status", value: "Not assessed", icon: FileLock2, tone: "text-muted-foreground" },
];

const tooltipStyle = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "10px",
  color: "var(--foreground)",
  fontSize: "12px",
};

function Analytics() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
        System Analytics & Security Evaluation
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Engine accuracy, anti-spoofing resilience and processing latency across the verification
        pipeline.
      </p>
      <p className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
        Illustrative sample figures — not measured results. Do not cite these as certified accuracy or
        compliance claims.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m, i) => {
          const Icon = m.icon;
          return (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="panel p-5"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  {m.label}
                </span>
                <Icon className={`size-4 ${m.tone}`} />
              </div>
              <p className={`mt-2 text-2xl font-semibold ${m.tone}`}>{m.value}</p>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="panel">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Accuracy & liveness resilience by attack type</CardTitle>
            <Badge className="bg-success/15 text-success ring-1 ring-success/30 hover:bg-success/15">
              Sample data
            </Badge>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={attackResilience} margin={{ left: -18, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="attack"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  interval={0}
                  angle={-12}
                  dy={10}
                  height={52}
                />
                <YAxis tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} domain={[0, 100]} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--secondary)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="detection"
                  name="Detection rate %"
                  fill="var(--chart-1)"
                  radius={[6, 6, 0, 0]}
                />
                <Bar
                  dataKey="rejection"
                  name="False rejection %"
                  fill="var(--chart-4)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="panel">
          <CardHeader>
            <CardTitle className="text-base">Processing latency breakdown</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={latencyBreakdown} layout="vertical" margin={{ left: 40, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  unit="s"
                />
                <YAxis
                  type="category"
                  dataKey="stage"
                  width={130}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--secondary)" }} />
                <Bar dataKey="seconds" name="Seconds" radius={[0, 6, 6, 0]}>
                  {latencyBreakdown.map((_, i) => (
                    <Cell key={i} fill={`var(--chart-${(i % 5) + 1})`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="panel mt-6">
        <CardHeader>
          <CardTitle className="text-base">Trust score trend (last 8 weeks)</CardTitle>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={[
                { week: "W1", score: 91.2, spoof: 0.31 },
                { week: "W2", score: 92.0, spoof: 0.28 },
                { week: "W3", score: 92.8, spoof: 0.24 },
                { week: "W4", score: 93.5, spoof: 0.22 },
                { week: "W5", score: 94.1, spoof: 0.19 },
                { week: "W6", score: 94.9, spoof: 0.16 },
                { week: "W7", score: 95.4, spoof: 0.14 },
                { week: "W8", score: 96.0, spoof: 0.12 },
              ]}
              margin={{ left: -16, right: 8, top: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="week" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
              <YAxis
                yAxisId="left"
                domain={[88, 100]}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={[0, 0.4]}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="score"
                name="Avg trust score"
                stroke="var(--chart-2)"
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="spoof"
                name="Spoof acceptance %"
                stroke="var(--chart-5)"
                strokeWidth={2.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </main>
  );
}
