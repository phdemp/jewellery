import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchEvaluationSummary,
  fetchEvaluations,
  fetchPromptVersions,
  fetchOptimizationRuns,
  activatePromptVersion as activateVersion,
  type EvaluationSummaryByModel,
  type EvaluationTimeSeries,
  type DesignEvaluationEntry,
  type PromptVersionEntry,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  BarChart, Bar,
} from "recharts";
import {
  Activity, GitBranch, Zap, ChevronDown, ChevronUp, CheckCircle,
} from "lucide-react";

const MODEL_COLORS: Record<string, string> = {
  gemini: "#4285F4",
  openai: "#10A37F",
  grok: "#FF6B35",
  manual: "#8B5CF6",
};

const DIMENSION_LABELS: Record<string, string> = {
  brand_compliance: "Brand Compliance",
  view_angle: "View Angle",
  composition: "Composition",
  motif_accuracy: "Motif Accuracy",
  stone_rendering: "Stone Rendering",
  gold_balance: "Gold Balance",
  overall_quality: "Overall Quality",
};

function ScoreBar({ label, value, max = 5 }: { label: string; value: number; max?: number }) {
  const pct = (value / max) * 100;
  const color = value >= 4 ? "#4A7C59" : value >= 3 ? "#C4862B" : "#A63C2A";
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-[#1A1814]/50 w-28 text-right" style={{ fontFamily: "'DM Mono', monospace" }}>
        {label}
      </span>
      <div className="flex-1 h-2 bg-[#1A1814]/5 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[12px] font-medium w-8" style={{ color }}>{value.toFixed(1)}</span>
    </div>
  );
}

function ModelSummaryCard({ data }: { data: EvaluationSummaryByModel }) {
  const dimensions = [
    { key: "brand_compliance", value: Number(data.avg_brand_compliance) },
    { key: "view_angle", value: Number(data.avg_view_angle) },
    { key: "composition", value: Number(data.avg_composition) },
    { key: "motif_accuracy", value: Number(data.avg_motif_accuracy) },
    { key: "stone_rendering", value: Number(data.avg_stone_rendering) },
    { key: "gold_balance", value: Number(data.avg_gold_balance) },
    { key: "overall_quality", value: Number(data.avg_overall_quality) },
  ];
  const avgAll = dimensions.reduce((s, d) => s + d.value, 0) / dimensions.length;

  return (
    <div className="bg-white rounded-lg border border-[#D4C9A8] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: MODEL_COLORS[data.model_provider] || "#6B6458" }} />
          <h3 className="text-sm font-medium capitalize" style={{ fontFamily: "'Jost', sans-serif" }}>
            {data.model_provider}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[#1A1814]/40" style={{ fontFamily: "'DM Mono', monospace" }}>
            {data.total} evals
          </span>
          <Badge
            className={cn(
              "text-[10px] px-1.5 py-0 border-0",
              avgAll >= 4 ? "bg-[#4A7C59]/10 text-[#4A7C59]"
                : avgAll >= 3 ? "bg-[#C4862B]/10 text-[#C4862B]"
                : "bg-[#A63C2A]/10 text-[#A63C2A]"
            )}
          >
            {avgAll.toFixed(2)} avg
          </Badge>
        </div>
      </div>
      <div className="space-y-2">
        {dimensions.map(d => (
          <ScoreBar key={d.key} label={DIMENSION_LABELS[d.key] || d.key} value={d.value} />
        ))}
      </div>
    </div>
  );
}

function RadarComparisonChart({ models }: { models: EvaluationSummaryByModel[] }) {
  const dimensions = ["brand_compliance", "view_angle", "composition", "motif_accuracy", "stone_rendering", "gold_balance", "overall_quality"];
  const radarData = dimensions.map(dim => {
    const entry: Record<string, string | number> = { dimension: DIMENSION_LABELS[dim] || dim };
    for (const m of models) {
      const key = `avg_${dim}` as keyof EvaluationSummaryByModel;
      entry[m.model_provider] = Number(m[key]) || 0;
    }
    return entry;
  });

  return (
    <div className="bg-white rounded-lg border border-[#D4C9A8] p-5">
      <h3 className="text-sm font-medium mb-3" style={{ fontFamily: "'Jost', sans-serif" }}>
        Model Comparison — Radar
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={radarData}>
          <PolarGrid stroke="#D4C9A8" />
          <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10, fill: "#6B6458" }} />
          <PolarRadiusAxis domain={[0, 5]} tick={{ fontSize: 9 }} />
          {models.map(m => (
            <Radar
              key={m.model_provider}
              name={m.model_provider}
              dataKey={m.model_provider}
              stroke={MODEL_COLORS[m.model_provider] || "#6B6458"}
              fill={MODEL_COLORS[m.model_provider] || "#6B6458"}
              fillOpacity={0.1}
            />
          ))}
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendChart({ timeSeries }: { timeSeries: EvaluationTimeSeries[] }) {
  // Group by date, flatten models
  const dateMap = new Map<string, Record<string, number>>();
  for (const row of timeSeries) {
    const dateStr = row.date?.toString().slice(0, 10) || "";
    if (!dateMap.has(dateStr)) dateMap.set(dateStr, { date: dateStr as unknown as number });
    dateMap.get(dateStr)![row.model_provider] = Number(row.avg_quality);
  }
  const chartData = Array.from(dateMap.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );

  const models = Array.from(new Set(timeSeries.map(t => t.model_provider)));

  if (chartData.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-[#D4C9A8] p-5">
        <h3 className="text-sm font-medium mb-3" style={{ fontFamily: "'Jost', sans-serif" }}>
          Quality Trend (30 days)
        </h3>
        <p className="text-xs text-[#1A1814]/40 text-center py-8">No data yet — evaluations will appear after generations.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-[#D4C9A8] p-5">
      <h3 className="text-sm font-medium mb-3" style={{ fontFamily: "'Jost', sans-serif" }}>
        Quality Trend (30 days)
      </h3>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#D4C9A8" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} />
          <YAxis domain={[1, 5]} tick={{ fontSize: 10 }} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {models.map(m => (
            <Line
              key={m}
              type="monotone"
              dataKey={m}
              stroke={MODEL_COLORS[m] || "#6B6458"}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PromptVersionsPanel() {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<string>("brand_rules");

  const { data } = useQuery({
    queryKey: ["prompt-versions", scopeFilter],
    queryFn: () => fetchPromptVersions(scopeFilter),
  });

  const activateMutation = useMutation({
    mutationFn: activateVersion,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prompt-versions"] });
    },
  });

  const versions = data?.items || [];

  return (
    <div className="bg-white rounded-lg border border-[#D4C9A8] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-[#C9A84C]" />
          <h3 className="text-sm font-medium" style={{ fontFamily: "'Jost', sans-serif" }}>
            Prompt Versions
          </h3>
        </div>
        <select
          value={scopeFilter}
          onChange={e => setScopeFilter(e.target.value)}
          className="text-xs border border-[#D4C9A8] rounded px-2 py-1 bg-white"
        >
          <option value="brand_rules">Brand Rules</option>
          <option value="cad_rules">CAD Rules</option>
          <option value="grok_preamble">Grok Preamble</option>
        </select>
      </div>

      {versions.length === 0 ? (
        <p className="text-xs text-[#1A1814]/40 text-center py-4">
          No versions yet. Versions are seeded on first server start after DB push.
        </p>
      ) : (
        <div className="space-y-2">
          {versions.map((v: PromptVersionEntry) => (
            <div key={v.id} className="border border-[#D4C9A8]/50 rounded p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-[#1A1814]/60">v{v.versionNumber}</span>
                  {v.isActive === 1 && (
                    <Badge className="text-[9px] px-1.5 bg-[#4A7C59]/10 text-[#4A7C59] border-0">
                      <CheckCircle className="w-3 h-3 mr-0.5" /> Active
                    </Badge>
                  )}
                  {v.generationCount != null && v.generationCount > 0 && (
                    <span className="text-[10px] text-[#1A1814]/30">{v.generationCount} generations</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {v.isActive !== 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-[10px] border-[#D4C9A8]"
                      disabled={activateMutation.isPending}
                      onClick={() => activateMutation.mutate(v.id)}
                    >
                      Activate
                    </Button>
                  )}
                  <button
                    onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}
                    className="p-1 hover:bg-[#FAF7F0] rounded"
                  >
                    {expandedId === v.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              {expandedId === v.id && (
                <pre className="mt-2 text-[10px] text-[#1A1814]/60 bg-[#FAF7F0] rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap">
                  {v.templateText}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecentEvaluationsTable() {
  const { data } = useQuery({
    queryKey: ["evaluations-recent"],
    queryFn: () => fetchEvaluations({ page: 1, limit: 10 }),
  });

  const items = data?.items || [];

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-[#D4C9A8] p-5">
        <h3 className="text-sm font-medium mb-3" style={{ fontFamily: "'Jost', sans-serif" }}>
          Recent Evaluations
        </h3>
        <p className="text-xs text-[#1A1814]/40 text-center py-4">
          No evaluations yet. Generate a design to trigger automatic evaluation.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-[#D4C9A8] p-5 overflow-x-auto">
      <h3 className="text-sm font-medium mb-3" style={{ fontFamily: "'Jost', sans-serif" }}>
        Recent Evaluations
      </h3>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-[#D4C9A8]/50">
            {["Model", "Brand", "View", "Comp", "Motif", "Stone", "Gold", "Overall", "Time"].map(h => (
              <th key={h} className="text-left py-1.5 px-2 text-[#1A1814]/40 font-medium" style={{ fontFamily: "'DM Mono', monospace" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((e: DesignEvaluationEntry) => (
            <tr key={e.id} className="border-b border-[#D4C9A8]/20 hover:bg-[#FAF7F0]">
              <td className="py-1.5 px-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: MODEL_COLORS[e.modelProvider] || "#6B6458" }} />
                  <span className="capitalize">{e.modelProvider}</span>
                </div>
              </td>
              <td className="py-1.5 px-2">{e.brandCompliance}</td>
              <td className="py-1.5 px-2">{e.viewAngle}</td>
              <td className="py-1.5 px-2">{e.composition}</td>
              <td className="py-1.5 px-2">{e.motifAccuracy}</td>
              <td className="py-1.5 px-2">{e.stoneRendering}</td>
              <td className="py-1.5 px-2">{e.goldBalance}</td>
              <td className="py-1.5 px-2 font-medium">{e.overallQuality}</td>
              <td className="py-1.5 px-2 text-[#1A1814]/30">
                {new Date(e.evaluatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OptimizationRunsPanel() {
  const { data } = useQuery({
    queryKey: ["optimization-runs"],
    queryFn: fetchOptimizationRuns,
  });

  const runs = data?.items || [];

  return (
    <div className="bg-white rounded-lg border border-[#D4C9A8] p-5">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-4 h-4 text-[#C9A84C]" />
        <h3 className="text-sm font-medium" style={{ fontFamily: "'Jost', sans-serif" }}>
          Optimization Runs
        </h3>
      </div>
      {runs.length === 0 ? (
        <p className="text-xs text-[#1A1814]/40 text-center py-4">
          No optimization runs yet. Trigger via POST /api/optimize-prompts when ready.
        </p>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <div key={run.id} className="border border-[#D4C9A8]/50 rounded p-3 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-mono">{run.scope}</span>
                <span className={cn(
                  "ml-2 text-[10px] px-1.5 py-0 rounded",
                  run.status === "completed" ? "bg-[#4A7C59]/10 text-[#4A7C59]"
                    : run.status === "failed" ? "bg-[#A63C2A]/10 text-[#A63C2A]"
                    : "bg-[#C4862B]/10 text-[#C4862B]"
                )}>
                  {run.status}
                </span>
              </div>
              <div className="text-[10px] text-[#1A1814]/40">
                {run.before_avg_score != null && run.after_avg_score != null && (
                  <span>
                    {(Number(run.before_avg_score) / 100).toFixed(2)} → {(Number(run.after_avg_score) / 100).toFixed(2)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function QualityPage() {
  const { data: summaryData, isLoading } = useQuery({
    queryKey: ["evaluation-summary"],
    queryFn: fetchEvaluationSummary,
  });

  const models = summaryData?.byModel || [];
  const timeSeries = summaryData?.timeSeries || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-[#C9A84C]" />
            <h2 className="text-lg font-medium" style={{ fontFamily: "'Cormorant Garamond', serif" }}>
              Generation Quality
            </h2>
          </div>
          <p className="text-xs text-[#1A1814]/40 mt-1" style={{ fontFamily: "'DM Mono', monospace" }}>
            AI-evaluated quality scores across all generated designs
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-xs text-[#1A1814]/40">Loading evaluation data...</div>
      ) : (
        <>
          {/* Model summary cards */}
          {models.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {models.map(m => <ModelSummaryCard key={m.model_provider} data={m} />)}
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-[#D4C9A8] p-8 text-center">
              <Activity className="w-8 h-8 text-[#D4C9A8] mx-auto mb-3" />
              <p className="text-sm text-[#1A1814]/50">No evaluations yet</p>
              <p className="text-xs text-[#1A1814]/30 mt-1">
                Generate a design to trigger automatic quality evaluation
              </p>
            </div>
          )}

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RadarComparisonChart models={models} />
            <TrendChart timeSeries={timeSeries} />
          </div>

          {/* Recent evaluations table */}
          <RecentEvaluationsTable />

          {/* Prompt versions + optimization runs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PromptVersionsPanel />
            <OptimizationRunsPanel />
          </div>
        </>
      )}
    </div>
  );
}
