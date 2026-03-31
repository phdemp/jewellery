import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import type { CostingReportData } from "@/lib/api";

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

interface CostReportProps {
  report: CostingReportData;
}

export function CostReport({ report }: CostReportProps) {
  return (
    <div id="cost-report" className="border border-border/60 rounded-xl p-6 bg-white space-y-6 print:border-0 print:p-0 print:rounded-none">
      {/* Header */}
      <div className="text-center border-b border-border/40 pb-4">
        <h3 className="font-serif text-xl font-bold tracking-wide">RANIWALA 1881 — AI Cost Estimate</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Generated: {new Date(report.generatedAt).toLocaleString("en-IN")}
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="Gold Cost" value={inr(report.gold.totalCost)} className="bg-amber-50 border-amber-200" />
        <SummaryCard label="Stone Cost" value={inr(report.totalStoneCost)} className="bg-teal-50 border-teal-200" />
        <SummaryCard label="Total Estimated" value={inr(report.totalEstimatedCost)} className="bg-slate-50 border-slate-200" />
        <SummaryCard
          label="After Making Charges"
          value={`${report.budgetVariance >= 0 ? "+" : ""}${inr(report.budgetVariance)}`}
          subtext={report.budgetVariance >= 0 ? "over budget" : "under budget"}
          className={report.budgetVariance >= 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}
          valueClass={report.budgetVariance >= 0 ? "text-red-700" : "text-green-700"}
        />
      </div>

      {/* Gold specification */}
      <div className="space-y-2">
        <h4 className="font-serif font-medium text-sm">Gold Specification</h4>
        <div className="bg-amber-50/50 border border-amber-100 rounded-lg p-4 text-sm space-y-1 font-mono">
          <p>Purity:           {report.gold.purity} ({(report.gold.purityFraction * 100).toFixed(1)}% pure)</p>
          <p>Today's Rate:     {inr(report.gold.ratePerGram)}/gram (24k)</p>
          <p>Effective Rate:   {inr(report.gold.effectiveRatePerGram)}/gram ({report.gold.purity})</p>
          <p>Estimated Weight: {report.gold.estimatedWeight.toFixed(1)}g</p>
          <p>Gold Cost:        {inr(report.gold.totalCost)}</p>
          <p>Making Charges:   {inr(report.makingCharges)} (@ ₹1,200/g × {report.gold.estimatedWeight.toFixed(1)}g)</p>
        </div>
      </div>

      {/* Stone tables */}
      {report.polki.length > 0 && (
        <ReportTable title="Polki Breakdown">
          <thead>
            <tr className="bg-muted/50">
              <th className="report-th">Sieve</th>
              <th className="report-th">Size</th>
              <th className="report-th text-right">Count</th>
              <th className="report-th text-right">Wt/piece</th>
              <th className="report-th text-right">Total Wt</th>
              <th className="report-th text-right">Rate/g</th>
              <th className="report-th text-right">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {report.polki.map((row, i) => (
              <tr key={i} className="border-b border-border/20">
                <td className="report-td">{row.sieve}</td>
                <td className="report-td">{row.size_mm}</td>
                <td className="report-td text-right">{row.count}</td>
                <td className="report-td text-right">{row.weightPerPiece.toFixed(3)}g</td>
                <td className="report-td text-right">{row.totalWeight.toFixed(3)}g</td>
                <td className="report-td text-right">{inr(row.ratePerGram)}</td>
                <td className="report-td text-right font-medium">{inr(row.totalCost)}</td>
              </tr>
            ))}
            <tr className="bg-muted/30 font-medium">
              <td className="report-td" colSpan={6}>Polki Subtotal</td>
              <td className="report-td text-right">{inr(report.polki.reduce((s, r) => s + r.totalCost, 0))}</td>
            </tr>
          </tbody>
        </ReportTable>
      )}

      {report.diamond.length > 0 && (
        <ReportTable title="Diamond Breakdown">
          <thead>
            <tr className="bg-muted/50">
              <th className="report-th">Sieve</th>
              <th className="report-th">Size</th>
              <th className="report-th text-right">Count</th>
              <th className="report-th text-right">Wt/piece (ct)</th>
              <th className="report-th text-right">Total (ct)</th>
              <th className="report-th text-right">Rate/ct</th>
              <th className="report-th text-right">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {report.diamond.map((row, i) => (
              <tr key={i} className="border-b border-border/20">
                <td className="report-td">{row.sieve}</td>
                <td className="report-td">{row.size_mm}</td>
                <td className="report-td text-right">{row.count}</td>
                <td className="report-td text-right">{row.weightPerPiece.toFixed(3)}</td>
                <td className="report-td text-right">{row.totalCarats.toFixed(3)}</td>
                <td className="report-td text-right">{inr(row.ratePerCarat)}</td>
                <td className="report-td text-right font-medium">{inr(row.totalCost)}</td>
              </tr>
            ))}
            <tr className="bg-muted/30 font-medium">
              <td className="report-td" colSpan={6}>Diamond Subtotal</td>
              <td className="report-td text-right">{inr(report.diamond.reduce((s, r) => s + r.totalCost, 0))}</td>
            </tr>
          </tbody>
        </ReportTable>
      )}

      {report.colorStones.length > 0 && (
        <ReportTable title="Colour Stone Breakdown">
          <thead>
            <tr className="bg-muted/50">
              <th className="report-th">Stone</th>
              <th className="report-th text-right">Carats</th>
              <th className="report-th text-right">Rate/ct</th>
              <th className="report-th text-right">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {report.colorStones.map((row, i) => (
              <tr key={i} className="border-b border-border/20">
                <td className="report-td">{row.type}</td>
                <td className="report-td text-right">{row.carats.toFixed(3)}</td>
                <td className="report-td text-right">{inr(row.ratePerCarat)}</td>
                <td className="report-td text-right font-medium">{inr(row.totalCost)}</td>
              </tr>
            ))}
            <tr className="bg-muted/30 font-medium">
              <td className="report-td" colSpan={3}>Colour Stone Subtotal</td>
              <td className="report-td text-right">{inr(report.colorStones.reduce((s, r) => s + r.totalCost, 0))}</td>
            </tr>
          </tbody>
        </ReportTable>
      )}

      {report.emeralds.length > 0 && (
        <ReportTable title="Emerald Breakdown">
          <thead>
            <tr className="bg-muted/50">
              <th className="report-th">Size</th>
              <th className="report-th text-right">Count</th>
              <th className="report-th text-right">Wt/piece (ct)</th>
              <th className="report-th text-right">Total (ct)</th>
              <th className="report-th text-right">Rate/ct</th>
              <th className="report-th text-right">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {report.emeralds.map((row, i) => (
              <tr key={i} className="border-b border-border/20">
                <td className="report-td">{row.size_mm}</td>
                <td className="report-td text-right">{row.count}</td>
                <td className="report-td text-right">{row.weightPerPiece.toFixed(3)}</td>
                <td className="report-td text-right">{row.totalCarats.toFixed(3)}</td>
                <td className="report-td text-right">{inr(row.ratePerCarat)}</td>
                <td className="report-td text-right font-medium">{inr(row.totalCost)}</td>
              </tr>
            ))}
            <tr className="bg-muted/30 font-medium">
              <td className="report-td" colSpan={5}>Emerald Subtotal</td>
              <td className="report-td text-right">{inr(report.emeralds.reduce((s, r) => s + r.totalCost, 0))}</td>
            </tr>
          </tbody>
        </ReportTable>
      )}

      {/* Grand total */}
      <div className="border-t-2 border-border/60 pt-4 space-y-1 font-mono text-sm">
        <div className="flex justify-between">
          <span>Total Stone Cost:</span>
          <span className="font-medium">{inr(report.totalStoneCost)}</span>
        </div>
        <div className="flex justify-between">
          <span>Gold Cost:</span>
          <span className="font-medium">{inr(report.gold.totalCost)}</span>
        </div>
        <div className="flex justify-between">
          <span>Making Charges (₹1,200/g):</span>
          <span className="font-medium">{inr(report.makingCharges)}</span>
        </div>
        <div className="border-t border-border/40 pt-2 mt-2 flex justify-between text-base font-bold">
          <span>TOTAL ESTIMATED COST:</span>
          <span>{inr(report.totalEstimatedCost)}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Budget (Price Band):</span>
          <span>{inr(report.input.totalBudget)}</span>
        </div>
        <div className={`flex justify-between font-bold ${report.budgetVariance >= 0 ? "text-red-700" : "text-green-700"}`}>
          <span>Variance:</span>
          <span>{inr(Math.abs(report.budgetVariance))} ({report.budgetVariance >= 0 ? "over" : "under"})</span>
        </div>
      </div>

      {/* Print button */}
      <div className="flex gap-3 pt-2 print:hidden">
        <Button type="button" variant="outline" onClick={() => window.print()}>
          <FileText className="w-4 h-4 mr-2" /> Print Report
        </Button>
      </div>

      {/* Print stylesheet */}
      <style>{`
        .report-th { padding: 6px 8px; font-size: 0.75rem; font-weight: 600; white-space: nowrap; }
        .report-td { padding: 6px 8px; font-size: 0.75rem; white-space: nowrap; }

        @media print {
          body > * { display: none !important; }
          #cost-report { display: block !important; position: absolute; top: 0; left: 0; width: 100%; }
          #cost-report { font-family: Arial, sans-serif; font-size: 11pt; color: #000; padding: 20mm; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
          th { background: #f5f0e8; }
        }
      `}</style>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SummaryCard({
  label, value, subtext, className = "", valueClass = "",
}: {
  label: string; value: string; subtext?: string; className?: string; valueClass?: string;
}) {
  return (
    <div className={`border rounded-lg p-3 ${className}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold font-mono ${valueClass}`}>{value}</p>
      {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
    </div>
  );
}

function ReportTable({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="font-serif font-medium text-sm">{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-border/40 text-sm">
          {children}
        </table>
      </div>
    </div>
  );
}
