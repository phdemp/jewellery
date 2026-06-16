import { useState, useMemo, createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fmt, fmtN, downloadCSV, getPriceBand,
  liveToInventoryItem, liveToSalesTransactions, aggregateClientsFromSales,
} from "../lib/intelligence-utils";
import { REPORT_DEFS, MONTH_NAMES, AGEING_RANGES } from "../lib/intelligence-constants";
import { cn } from "@/lib/utils";
import type { InventoryItem, SalesTransaction } from "../lib/intelligence-types";
import { fetchStockItems, fetchSalesData, fetchExhibitionList } from "@/lib/api";
import type { ExhibitionSummary } from "@/lib/api";
import * as XLSX from "xlsx";

type ReportKey = keyof typeof REPORT_DEFS;

interface MemoLite {
  salesPerson: string;
  tagPrice: number;
}

// Live data shared across all report renderers (fetched once in ReportsPage).
interface ReportsData {
  inventory: InventoryItem[];
  sales: SalesTransaction[];
  memoItems: MemoLite[];
  exhibitions: ExhibitionSummary[];
  onHandCount: number;
  peakMonth: string;
  peakRevenue: number;
}

const ReportsDataContext = createContext<ReportsData | null>(null);

function useReportsData(): ReportsData {
  const ctx = useContext(ReportsDataContext);
  if (!ctx) throw new Error("useReportsData must be used within ReportsDataContext");
  return ctx;
}

const AGEING_ORDER = ["Fresh", "Active", "Moderate", "Slow Moving", "Ageing", "Non-Moving"];

// --------------------------------------------------------------------------
// Summary stat helper
// --------------------------------------------------------------------------

interface SummaryStat {
  label: string;
  value: string;
}

function SummaryBar({ stats }: { stats: SummaryStat[] }) {
  return (
    <div className="grid grid-cols-4 border-b border-[#D4C9A8]">
      {stats.map((s, i) => (
        <div
          key={i}
          className={cn(
            "p-4",
            i < stats.length - 1 && "border-r border-[#D4C9A8]"
          )}
        >
          <p
            className="text-[9px] tracking-[1.5px] uppercase mb-1"
            style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
          >
            {s.label}
          </p>
          <p
            className="text-xl tabular-nums"
            style={{ fontFamily: "'Jost', sans-serif", color: "#1A1814" }}
          >
            {s.value}
          </p>
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------------
// Reusable report table
// --------------------------------------------------------------------------

interface TableColumn {
  header: string;
  accessor: (row: Record<string, unknown>, idx: number) => string | number;
  align?: "left" | "right" | "center";
}

function ReportTable({
  columns,
  rows,
  totalRow,
}: {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  totalRow?: Record<string, unknown>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            {columns.map((col, i) => (
              <th
                key={i}
                className={cn(
                  "px-3 py-2.5 bg-[#F5F1E8] sticky top-0 text-[9.5px] tracking-[1.5px] uppercase",
                  col.align === "right" ? "text-right" : "text-left"
                )}
                style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="hover:bg-[#F5F1E8] transition-colors">
              {columns.map((col, ci) => (
                <td
                  key={ci}
                  className={cn(
                    "px-3 py-2 text-[12.5px] border-b border-[#EDE7D8]",
                    col.align === "right" ? "text-right" : "text-left"
                  )}
                  style={{ color: "#3D3830" }}
                >
                  {col.accessor(row, ri)}
                </td>
              ))}
            </tr>
          ))}
          {totalRow && (
            <tr className="font-semibold bg-[#EDE7D8] border-t-2 border-[#D4C9A8]">
              {columns.map((col, ci) => (
                <td
                  key={ci}
                  className={cn(
                    "px-3 py-2 text-[12.5px]",
                    col.align === "right" ? "text-right" : "text-left"
                  )}
                  style={{ color: "#3D3830" }}
                >
                  {col.accessor(totalRow, -1)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// --------------------------------------------------------------------------
// Individual report renderers
// --------------------------------------------------------------------------

function TopSellingReport() {
  const { sales } = useReportsData();
  const grouped = useMemo(() => {
    const map = new Map<string, { units: number; revenue: number; clients: Set<string> }>();
    for (const s of sales) {
      const existing = map.get(s.styleCode) || { units: 0, revenue: 0, clients: new Set<string>() };
      existing.units += 1;
      existing.revenue += s.transPrice;
      existing.clients.add(s.clientName);
      map.set(s.styleCode, existing);
    }
    return Array.from(map.entries())
      .map(([code, d]) => ({
        styleCode: code,
        units: d.units,
        revenue: d.revenue,
        clients: d.clients.size,
      }))
      .sort((a, b) => b.units - a.units);
  }, [sales]);

  const totalUnits = grouped.reduce((s, r) => s + r.units, 0);
  const totalRevenue = grouped.reduce((s, r) => s + r.revenue, 0);

  const cols: TableColumn[] = [
    { header: "#", accessor: (_r, i) => i + 1, align: "center" },
    { header: "Style Code", accessor: (r) => String(r.styleCode) },
    { header: "Units Sold", accessor: (r) => fmtN(r.units as number), align: "right" },
    { header: "Revenue", accessor: (r) => fmt(r.revenue as number), align: "right" },
    { header: "Unique Clients", accessor: (r) => fmtN(r.clients as number), align: "right" },
  ];

  return (
    <>
      <SummaryBar
        stats={[
          { label: "Unique SKUs Sold", value: String(grouped.length) },
          { label: "Total Units", value: fmtN(totalUnits) },
          { label: "Total Revenue", value: fmt(totalRevenue) },
          { label: "Avg Revenue/SKU", value: grouped.length ? fmt(Math.round(totalRevenue / grouped.length)) : "---" },
        ]}
      />
      <ReportTable
        columns={cols}
        rows={grouped.slice(0, 50) as unknown as Record<string, unknown>[]}
        totalRow={{ styleCode: "TOTAL", units: totalUnits, revenue: totalRevenue, clients: "---" } as unknown as Record<string, unknown>}
      />
      <ExportBar
        filename="top-selling-report.csv"
        headers={["Style Code", "Units Sold", "Revenue", "Unique Clients"]}
        rows={grouped.map((r) => [r.styleCode, r.units, r.revenue, r.clients])}
      />
    </>
  );
}

function DeadStockReport() {
  const { inventory, onHandCount } = useReportsData();
  const items = useMemo(
    () =>
      inventory
        .filter((i) => i.status === "On Hand" && i.ageingDays > 365)
        .map((i) => ({
          "Jewel Code": i.jewelCode,
          "Style No": i.styleNo,
          "Cat Simple": i.catSimple,
          "Location Name": i.location,
          "Tag Price": i.tagPrice,
          "Ageing Days": i.ageingDays,
        }))
        .sort((a, b) => b["Ageing Days"] - a["Ageing Days"]),
    [inventory]
  );

  const totalValue = items.reduce((s, r) => s + r["Tag Price"], 0);
  const avgAgeing = items.length
    ? Math.round(items.reduce((s, r) => s + r["Ageing Days"], 0) / items.length)
    : 0;

  const cols: TableColumn[] = [
    { header: "#", accessor: (_r, i) => i + 1, align: "center" },
    { header: "Jewel Code", accessor: (r) => String(r["Jewel Code"]) },
    { header: "Style No", accessor: (r) => String(r["Style No"]) },
    { header: "Category", accessor: (r) => String(r["Cat Simple"]) },
    { header: "Location", accessor: (r) => String(r["Location Name"]) },
    { header: "Tag Price", accessor: (r) => fmt(r["Tag Price"] as number), align: "right" },
    { header: "Ageing Days", accessor: (r) => fmtN(r["Ageing Days"] as number), align: "right" },
  ];

  return (
    <>
      <SummaryBar
        stats={[
          { label: "Dead Stock Items", value: String(items.length) },
          { label: "Total Tag Value", value: fmt(totalValue) },
          { label: "Avg Ageing", value: avgAgeing + " days" },
          { label: "% of Inventory", value: onHandCount ? ((items.length / onHandCount) * 100).toFixed(1) + "%" : "---" },
        ]}
      />
      <ReportTable
        columns={cols}
        rows={items as unknown as Record<string, unknown>[]}
        totalRow={{ "Jewel Code": "TOTAL", "Style No": "", "Cat Simple": "", "Location Name": "", "Tag Price": totalValue, "Ageing Days": avgAgeing } as unknown as Record<string, unknown>}
      />
      <ExportBar
        filename="dead-stock-report.csv"
        headers={["Jewel Code", "Style No", "Category", "Location", "Tag Price", "Ageing Days"]}
        rows={items.map((r) => [r["Jewel Code"], r["Style No"], r["Cat Simple"], r["Location Name"], r["Tag Price"], r["Ageing Days"]])}
      />
    </>
  );
}

function AgeingReport() {
  const { inventory } = useReportsData();

  // Ageing buckets derived live (On Hand only)
  const buckets = useMemo(() => {
    const map = new Map<string, { count: number; cost_val: number; tag_val: number }>();
    for (const item of inventory) {
      if (item.status !== "On Hand") continue;
      const e = map.get(item.ageingTag) || { count: 0, cost_val: 0, tag_val: 0 };
      e.count += 1;
      e.cost_val += item.costPrice;
      e.tag_val += item.tagPrice;
      map.set(item.ageingTag, e);
    }
    return AGEING_ORDER.filter((tag) => map.has(tag)).map((tag) => ({
      "Ageing Tag": tag,
      ...map.get(tag)!,
    }));
  }, [inventory]);

  const totalCount = buckets.reduce((s, b) => s + b.count, 0);
  const totalCost = buckets.reduce((s, b) => s + b.cost_val, 0);
  const totalTag = buckets.reduce((s, b) => s + b.tag_val, 0);

  // Location breakdown by ageing
  const locBreakdown = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const item of inventory) {
      if (item.status !== "On Hand") continue;
      const loc = item.location;
      if (!map.has(loc)) map.set(loc, { Fresh: 0, Active: 0, Moderate: 0, "Slow Moving": 0, Ageing: 0, "Non-Moving": 0 });
      const entry = map.get(loc)!;
      entry[item.ageingTag] = (entry[item.ageingTag] || 0) + 1;
    }
    return Array.from(map.entries()).map(([loc, counts]) => ({ location: loc, ...counts }));
  }, [inventory]);

  const cols: TableColumn[] = [
    { header: "Ageing Bucket", accessor: (r) => String(r["Ageing Tag"]) },
    { header: "Range", accessor: (r) => AGEING_RANGES[String(r["Ageing Tag"])] || "" },
    { header: "Count", accessor: (r) => fmtN(r.count as number), align: "right" },
    { header: "Cost Value", accessor: (r) => fmt(r.cost_val as number), align: "right" },
    { header: "Tag Value", accessor: (r) => fmt(r.tag_val as number), align: "right" },
    { header: "% Count", accessor: (r) => totalCount ? ((r.count as number) / totalCount * 100).toFixed(1) + "%" : "---", align: "right" },
  ];

  const locCols: TableColumn[] = [
    { header: "Location", accessor: (r) => String(r.location) },
    { header: "Fresh", accessor: (r) => fmtN(r.Fresh as number), align: "right" },
    { header: "Active", accessor: (r) => fmtN(r.Active as number), align: "right" },
    { header: "Moderate", accessor: (r) => fmtN(r.Moderate as number), align: "right" },
    { header: "Slow Moving", accessor: (r) => fmtN(r["Slow Moving"] as number), align: "right" },
    { header: "Ageing", accessor: (r) => fmtN(r.Ageing as number), align: "right" },
    { header: "Non-Moving", accessor: (r) => fmtN(r["Non-Moving"] as number), align: "right" },
  ];

  return (
    <>
      <SummaryBar
        stats={[
          { label: "Total On-Hand", value: String(totalCount) },
          { label: "Total Cost", value: fmt(totalCost) },
          { label: "Total Tag", value: fmt(totalTag) },
          { label: "Non-Moving %", value: totalCount ? ((buckets.find((b) => (b["Ageing Tag"] as string) === "Non-Moving")?.count || 0) / totalCount * 100).toFixed(1) + "%" : "---" },
        ]}
      />
      <div className="mb-4">
        <h4
          className="text-[11px] tracking-[1.5px] uppercase px-3 py-2"
          style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
        >
          BY AGEING BUCKET
        </h4>
        <ReportTable
          columns={cols}
          rows={buckets as unknown as Record<string, unknown>[]}
          totalRow={{ "Ageing Tag": "TOTAL", count: totalCount, cost_val: totalCost, tag_val: totalTag } as unknown as Record<string, unknown>}
        />
      </div>
      <div>
        <h4
          className="text-[11px] tracking-[1.5px] uppercase px-3 py-2"
          style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
        >
          BY LOCATION
        </h4>
        <ReportTable
          columns={locCols}
          rows={locBreakdown as unknown as Record<string, unknown>[]}
        />
      </div>
      <ExportBar
        filename="ageing-report.csv"
        headers={["Ageing Bucket", "Range", "Count", "Cost Value", "Tag Value"]}
        rows={buckets.map((b) => [b["Ageing Tag"], AGEING_RANGES[b["Ageing Tag"]] || "", b.count, b.cost_val, b.tag_val])}
      />
    </>
  );
}

function MarginReport() {
  const { inventory } = useReportsData();
  const items = useMemo(
    () =>
      inventory
        .filter((i) => i.status === "On Hand")
        .map((i) => ({
          "Jewel Code": i.jewelCode,
          "Style No": i.styleNo,
          "Cat Simple": i.catSimple,
          "Tag Price": i.tagPrice,
          GP_pct: i.gp,
          "Ageing Tag": i.ageingTag,
        }))
        .sort((a, b) => b.GP_pct - a.GP_pct)
        .slice(0, 100),
    [inventory]
  );

  const avgGP = items.length
    ? (items.reduce((s, r) => s + r.GP_pct, 0) / items.length).toFixed(1)
    : "0";
  const totalTag = items.reduce((s, r) => s + r["Tag Price"], 0);

  const cols: TableColumn[] = [
    { header: "#", accessor: (_r, i) => i + 1, align: "center" },
    { header: "Jewel Code", accessor: (r) => String(r["Jewel Code"]) },
    { header: "Style No", accessor: (r) => String(r["Style No"]) },
    { header: "Category", accessor: (r) => String(r["Cat Simple"]) },
    { header: "Tag Price", accessor: (r) => fmt(r["Tag Price"] as number), align: "right" },
    { header: "GP%", accessor: (r) => (r.GP_pct as number).toFixed(1) + "%", align: "right" },
    { header: "Ageing", accessor: (r) => String(r["Ageing Tag"]) },
  ];

  return (
    <>
      <SummaryBar
        stats={[
          { label: "High Margin Items", value: String(items.length) },
          { label: "Avg GP%", value: avgGP + "%" },
          { label: "Total Tag Value", value: fmt(totalTag) },
          { label: "Top GP%", value: items.length ? items[0].GP_pct.toFixed(1) + "%" : "---" },
        ]}
      />
      <ReportTable
        columns={cols}
        rows={items as unknown as Record<string, unknown>[]}
      />
      <ExportBar
        filename="high-margin-report.csv"
        headers={["Jewel Code", "Style No", "Category", "Tag Price", "GP%", "Ageing Tag"]}
        rows={items.map((r) => [r["Jewel Code"], r["Style No"], r["Cat Simple"], r["Tag Price"], r.GP_pct, r["Ageing Tag"]])}
      />
    </>
  );
}

function AssortmentMixReport() {
  const { inventory } = useReportsData();
  // Build price band x category matrix
  const matrix = useMemo(() => {
    const bandCats = new Map<string, Map<string, number>>();
    const allCats = new Set<string>();

    for (const item of inventory) {
      if (item.status !== "On Hand") continue;
      const band = getPriceBand(item.tagPrice);
      const cat = item.catSimple || item.category || "Other";
      allCats.add(cat);

      if (!bandCats.has(band)) bandCats.set(band, new Map());
      const catMap = bandCats.get(band)!;
      catMap.set(cat, (catMap.get(cat) || 0) + 1);
    }

    const cats = Array.from(allCats).sort();
    const bands = ["Under \u20B925K", "\u20B925K\u201375K", "\u20B975K\u20132L", "Above \u20B92L"];
    const rows = bands.map((band) => {
      const catMap = bandCats.get(band) || new Map();
      const row: Record<string, unknown> = { band };
      let total = 0;
      for (const c of cats) {
        const v = catMap.get(c) || 0;
        row[c] = v;
        total += v;
      }
      row.total = total;
      return row;
    });

    return { rows, cats, bands };
  }, [inventory]);

  const totalItems = matrix.rows.reduce((s, r) => s + (r.total as number), 0);

  const cols: TableColumn[] = [
    { header: "Price Band", accessor: (r) => String(r.band) },
    ...matrix.cats.map((c) => ({
      header: c,
      accessor: (r: Record<string, unknown>) => fmtN(r[c] as number),
      align: "right" as const,
    })),
    { header: "Total", accessor: (r) => fmtN(r.total as number), align: "right" },
  ];

  // Grand total row
  const totalRow: Record<string, unknown> = { band: "TOTAL" };
  for (const c of matrix.cats) {
    totalRow[c] = matrix.rows.reduce((s, r) => s + (r[c] as number || 0), 0);
  }
  totalRow.total = totalItems;

  return (
    <>
      <SummaryBar
        stats={[
          { label: "Total On-Hand", value: String(totalItems) },
          { label: "Categories", value: String(matrix.cats.length) },
          { label: "Price Bands", value: String(matrix.bands.length) },
          { label: "Avg per Cell", value: fmtN(Math.round(totalItems / (matrix.cats.length * matrix.bands.length))) },
        ]}
      />
      <ReportTable columns={cols} rows={matrix.rows} totalRow={totalRow} />
    </>
  );
}

function ClientReport() {
  const { sales } = useReportsData();
  const clients = useMemo(() => {
    return aggregateClientsFromSales(sales)
      .filter((c) => c.txnCount > 0)
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 50);
  }, [sales]);

  const totalSpend = clients.reduce((s, c) => s + c.totalSpend, 0);
  const totalTxns = clients.reduce((s, c) => s + c.txnCount, 0);

  function clientTag(c: typeof clients[number]): string {
    if (c.txnCount >= 10) return "VIP";
    if (c.txnCount >= 3) return "Repeat";
    return "One-time";
  }

  function clientTagClass(tag: string): string {
    if (tag === "VIP") return "bg-[#E8F0FE] text-[#1A56CC]";
    if (tag === "Repeat") return "bg-[#EAF4E8] text-[#276520]";
    return "bg-[#F5F1E8] text-[#3D3830]";
  }

  const cols: TableColumn[] = [
    { header: "#", accessor: (_r, i) => i + 1, align: "center" },
    { header: "Client Name", accessor: (r) => String(r.name) },
    { header: "Total Spend", accessor: (r) => fmt(r.totalSpend as number), align: "right" },
    { header: "Transactions", accessor: (r) => fmtN(r.txnCount as number), align: "right" },
    { header: "Avg Order", accessor: (r) => fmt(r.avgOrder as number), align: "right" },
    {
      header: "Segment",
      accessor: (r) => clientTag(r as unknown as typeof clients[number]),
    },
  ];

  return (
    <>
      <SummaryBar
        stats={[
          { label: "Clients Shown", value: String(clients.length) },
          { label: "Total Spend", value: fmt(totalSpend) },
          { label: "Total Txns", value: fmtN(totalTxns) },
          { label: "Avg Order", value: totalTxns ? fmt(Math.round(totalSpend / totalTxns)) : "---" },
        ]}
      />
      {/* Custom table for client tags */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {cols.map((col, i) => (
                <th
                  key={i}
                  className={cn(
                    "px-3 py-2.5 bg-[#F5F1E8] sticky top-0 text-[9.5px] tracking-[1.5px] uppercase",
                    col.align === "right" ? "text-right" : "text-left"
                  )}
                  style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clients.map((c, ri) => {
              const tag = clientTag(c);
              return (
                <tr key={ri} className="hover:bg-[#F5F1E8] transition-colors">
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8] text-center" style={{ color: "#3D3830" }}>{ri + 1}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8]" style={{ color: "#3D3830" }}>{c.name}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8] text-right" style={{ color: "#3D3830" }}>{fmt(c.totalSpend)}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8] text-right" style={{ color: "#3D3830" }}>{fmtN(c.txnCount)}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8] text-right" style={{ color: "#3D3830" }}>{fmt(c.avgOrder)}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8]">
                    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium", clientTagClass(tag))}>{tag}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ExportBar
        filename="client-performance-report.csv"
        headers={["Client Name", "Total Spend", "Transactions", "Avg Order", "Segment"]}
        rows={clients.map((c) => [c.name, c.totalSpend, c.txnCount, c.avgOrder, clientTag(c)])}
      />
    </>
  );
}

function ChannelReport() {
  const { sales } = useReportsData();
  const channels = useMemo(() => {
    const map = new Map<string, { revenue: number; count: number }>();
    for (const s of sales) {
      const e = map.get(s.salesPerson) || { revenue: 0, count: 0 };
      e.revenue += s.transPrice;
      e.count += 1;
      map.set(s.salesPerson, e);
    }
    return Array.from(map.entries())
      .map(([SalesPersonName, d]) => ({ SalesPersonName, revenue: d.revenue, count: d.count }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [sales]);
  const totalRevenue = channels.reduce((s, c) => s + c.revenue, 0);
  const totalCount = channels.reduce((s, c) => s + c.count, 0);
  const maxRevenue = channels.length ? channels[0].revenue : 1;

  return (
    <>
      <SummaryBar
        stats={[
          { label: "Channels", value: String(channels.length) },
          { label: "Total Revenue", value: fmt(totalRevenue) },
          { label: "Total Txns", value: fmtN(totalCount) },
          { label: "Top Channel", value: channels.length ? channels[0].SalesPersonName : "---" },
        ]}
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Channel", "Revenue", "Share", "Txns", ""].map((h, i) => (
                <th
                  key={i}
                  className={cn(
                    "px-3 py-2.5 bg-[#F5F1E8] sticky top-0 text-[9.5px] tracking-[1.5px] uppercase",
                    (i === 1 || i === 3) ? "text-right" : "text-left"
                  )}
                  style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channels.map((ch, i) => {
              const share = totalRevenue ? (ch.revenue / totalRevenue) * 100 : 0;
              const barWidth = maxRevenue ? (ch.revenue / maxRevenue) * 100 : 0;
              return (
                <tr key={i} className="hover:bg-[#F5F1E8] transition-colors">
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8]" style={{ color: "#3D3830" }}>
                    {ch.SalesPersonName}
                  </td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8] text-right" style={{ color: "#3D3830" }}>
                    {fmt(ch.revenue)}
                  </td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8]" style={{ color: "#3D3830" }}>
                    {share.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8] text-right" style={{ color: "#3D3830" }}>
                    {fmtN(ch.count)}
                  </td>
                  <td className="px-3 py-2 border-b border-[#EDE7D8]" style={{ minWidth: 120 }}>
                    <div className="w-full bg-[#F5F1E8] rounded-[4px] h-[7px]">
                      <div
                        className="h-[7px] rounded-[4px]"
                        style={{ width: barWidth + "%", backgroundColor: "#C9A84C" }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr className="font-semibold bg-[#EDE7D8] border-t-2 border-[#D4C9A8]">
              <td className="px-3 py-2 text-[12.5px]" style={{ color: "#3D3830" }}>TOTAL</td>
              <td className="px-3 py-2 text-[12.5px] text-right" style={{ color: "#3D3830" }}>{fmt(totalRevenue)}</td>
              <td className="px-3 py-2 text-[12.5px]" style={{ color: "#3D3830" }}>100%</td>
              <td className="px-3 py-2 text-[12.5px] text-right" style={{ color: "#3D3830" }}>{fmtN(totalCount)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <ExportBar
        filename="channel-revenue-report.csv"
        headers={["Channel", "Revenue", "Share%", "Txns"]}
        rows={channels.map((ch) => [ch.SalesPersonName, ch.revenue, totalRevenue ? ((ch.revenue / totalRevenue) * 100).toFixed(1) : 0, ch.count])}
      />
    </>
  );
}

function MonthlyReport() {
  const { sales, peakMonth, peakRevenue } = useReportsData();
  const months = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sales) {
      const mk = s.transDate ? s.transDate.slice(0, 7) : "";
      if (mk) map.set(mk, (map.get(mk) || 0) + s.transPrice);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month_str, revenue]) => ({ month_str, revenue }));
  }, [sales]);
  const totalRevenue = months.reduce((s, m) => s + m.revenue, 0);
  const avgRevenue = months.length ? totalRevenue / months.length : 0;
  const maxRevenue = Math.max(...months.map((m) => m.revenue), 1);

  // Cumulative
  let cumulative = 0;
  const rows = months.map((m) => {
    cumulative += m.revenue;
    const vsAvg = avgRevenue ? ((m.revenue - avgRevenue) / avgRevenue) * 100 : 0;
    return {
      month: MONTH_NAMES[m.month_str] || m.month_str,
      revenue: m.revenue,
      cumulative,
      vsAvg,
      barWidth: maxRevenue ? (m.revenue / maxRevenue) * 100 : 0,
    };
  });

  return (
    <>
      <SummaryBar
        stats={[
          { label: "FY Revenue", value: fmt(totalRevenue) },
          { label: "Monthly Avg", value: fmt(Math.round(avgRevenue)) },
          { label: "Peak Month", value: peakMonth },
          { label: "Peak Revenue", value: fmt(peakRevenue) },
        ]}
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["Month", "Revenue", "Cumulative", "vs Avg", ""].map((h, i) => (
                <th
                  key={i}
                  className={cn(
                    "px-3 py-2.5 bg-[#F5F1E8] sticky top-0 text-[9.5px] tracking-[1.5px] uppercase",
                    (i === 1 || i === 2) ? "text-right" : "text-left"
                  )}
                  style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-[#F5F1E8] transition-colors">
                <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8]" style={{ color: "#3D3830" }}>
                  {r.month}
                </td>
                <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8] text-right" style={{ color: "#3D3830" }}>
                  {fmt(r.revenue)}
                </td>
                <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8] text-right" style={{ color: "#3D3830" }}>
                  {fmt(r.cumulative)}
                </td>
                <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8]" style={{ color: r.vsAvg >= 0 ? "#276520" : "#A63C2A" }}>
                  {r.vsAvg >= 0 ? "+" : ""}{r.vsAvg.toFixed(1)}%
                </td>
                <td className="px-3 py-2 border-b border-[#EDE7D8]" style={{ minWidth: 120 }}>
                  <div className="w-full bg-[#F5F1E8] rounded-[4px] h-[7px]">
                    <div
                      className="h-[7px] rounded-[4px]"
                      style={{ width: r.barWidth + "%", backgroundColor: r.vsAvg >= 0 ? "#4A7C59" : "#D4721E" }}
                    />
                  </div>
                </td>
              </tr>
            ))}
            <tr className="font-semibold bg-[#EDE7D8] border-t-2 border-[#D4C9A8]">
              <td className="px-3 py-2 text-[12.5px]" style={{ color: "#3D3830" }}>TOTAL</td>
              <td className="px-3 py-2 text-[12.5px] text-right" style={{ color: "#3D3830" }}>{fmt(totalRevenue)}</td>
              <td className="px-3 py-2 text-[12.5px] text-right" style={{ color: "#3D3830" }}>{fmt(totalRevenue)}</td>
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <ExportBar
        filename="monthly-revenue-report.csv"
        headers={["Month", "Revenue", "Cumulative", "vs Avg%"]}
        rows={rows.map((r) => [r.month, r.revenue, r.cumulative, r.vsAvg.toFixed(1)])}
      />
    </>
  );
}

function BdmPerfReport() {
  const { sales, memoItems } = useReportsData();

  // BDM performance derived live from sales rows
  const bdms = useMemo(() => {
    const map = new Map<string, { revenue: number; sold: number; clients: Set<string> }>();
    for (const s of sales) {
      const name = s.salesPerson || "Unknown";
      const e = map.get(name) || { revenue: 0, sold: 0, clients: new Set<string>() };
      e.revenue += s.transPrice;
      e.sold += 1;
      if (s.clientName) e.clients.add(s.clientName);
      map.set(name, e);
    }
    return Array.from(map.entries())
      .map(([SalesPersonName, d]) => ({
        SalesPersonName,
        revenue: d.revenue,
        sold_count: d.sold,
        clients: d.clients.size,
        avg_order: d.sold > 0 ? Math.round(d.revenue / d.sold) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [sales]);

  const totalRevenue = bdms.reduce((s, b) => s + b.revenue, 0);
  const totalSold = bdms.reduce((s, b) => s + b.sold_count, 0);
  const totalClients = bdms.reduce((s, b) => s + b.clients, 0);
  const maxRevenue = bdms.length ? bdms[0].revenue : 1;

  // Memo summary per BDM (live Memo stock items)
  const memoByBdm = useMemo(() => {
    const map = new Map<string, { count: number; value: number }>();
    for (const m of memoItems) {
      const key = m.salesPerson;
      if (!key || key === "nan") continue;
      const entry = map.get(key) || { count: 0, value: 0 };
      entry.count += 1;
      entry.value += m.tagPrice;
      map.set(key, entry);
    }
    return map;
  }, [memoItems]);

  return (
    <>
      <SummaryBar
        stats={[
          { label: "BDMs", value: String(bdms.length) },
          { label: "Total Revenue", value: fmt(totalRevenue) },
          { label: "Total Sold", value: fmtN(totalSold) },
          { label: "Total Clients", value: fmtN(totalClients) },
        ]}
      />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["BDM", "Revenue", "Share", "Sold", "Clients", "Avg Order", "Memo Count", "Memo Value", ""].map((h, i) => (
                <th
                  key={i}
                  className={cn(
                    "px-3 py-2.5 bg-[#F5F1E8] sticky top-0 text-[9.5px] tracking-[1.5px] uppercase",
                    [1, 3, 4, 5, 6, 7].includes(i) ? "text-right" : "text-left"
                  )}
                  style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bdms.map((b, i) => {
              const share = totalRevenue ? (b.revenue / totalRevenue) * 100 : 0;
              const barWidth = maxRevenue ? (b.revenue / maxRevenue) * 100 : 0;
              const memo = memoByBdm.get(b.SalesPersonName);
              return (
                <tr key={i} className="hover:bg-[#F5F1E8] transition-colors">
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8]" style={{ color: "#3D3830" }}>{b.SalesPersonName}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8] text-right" style={{ color: "#3D3830" }}>{fmt(b.revenue)}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8]" style={{ color: "#3D3830" }}>{share.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8] text-right" style={{ color: "#3D3830" }}>{fmtN(b.sold_count)}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8] text-right" style={{ color: "#3D3830" }}>{fmtN(b.clients)}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8] text-right" style={{ color: "#3D3830" }}>{fmt(b.avg_order)}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8] text-right" style={{ color: "#3D3830" }}>{memo ? fmtN(memo.count) : "---"}</td>
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8] text-right" style={{ color: "#3D3830" }}>{memo ? fmt(memo.value) : "---"}</td>
                  <td className="px-3 py-2 border-b border-[#EDE7D8]" style={{ minWidth: 100 }}>
                    <div className="w-full bg-[#F5F1E8] rounded-[4px] h-[7px]">
                      <div className="h-[7px] rounded-[4px]" style={{ width: barWidth + "%", backgroundColor: "#C9A84C" }} />
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr className="font-semibold bg-[#EDE7D8] border-t-2 border-[#D4C9A8]">
              <td className="px-3 py-2 text-[12.5px]" style={{ color: "#3D3830" }}>TOTAL</td>
              <td className="px-3 py-2 text-[12.5px] text-right" style={{ color: "#3D3830" }}>{fmt(totalRevenue)}</td>
              <td className="px-3 py-2 text-[12.5px]" style={{ color: "#3D3830" }}>100%</td>
              <td className="px-3 py-2 text-[12.5px] text-right" style={{ color: "#3D3830" }}>{fmtN(totalSold)}</td>
              <td className="px-3 py-2 text-[12.5px] text-right" style={{ color: "#3D3830" }}>{fmtN(totalClients)}</td>
              <td />
              <td />
              <td />
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <ExportBar
        filename="bdm-performance-report.csv"
        headers={["BDM", "Revenue", "Share%", "Sold", "Clients", "Avg Order"]}
        rows={bdms.map((b) => [b.SalesPersonName, b.revenue, totalRevenue ? ((b.revenue / totalRevenue) * 100).toFixed(1) : 0, b.sold_count, b.clients, b.avg_order])}
      />
    </>
  );
}

function ExhibitionReport() {
  const { exhibitions } = useReportsData();
  const totalInterests = exhibitions.reduce((s, e) => s + e.interestCount, 0);
  const totalSkus = exhibitions.reduce((s, e) => s + e.uniqueSkuCount, 0);
  const totalCustomers = exhibitions.reduce((s, e) => s + e.customerCount, 0);

  const cols: TableColumn[] = [
    { header: "Exhibition", accessor: (r) => String(r.name) },
    { header: "Interest Count", accessor: (r) => fmtN(r.interestCount as number), align: "right" },
    { header: "Unique SKUs", accessor: (r) => fmtN(r.uniqueSkuCount as number), align: "right" },
    { header: "Customers", accessor: (r) => fmtN(r.customerCount as number), align: "right" },
  ];

  return (
    <>
      <SummaryBar
        stats={[
          { label: "Exhibitions", value: String(exhibitions.length) },
          { label: "Total Interests", value: fmtN(totalInterests) },
          { label: "Unique SKUs", value: fmtN(totalSkus) },
          { label: "Total Customers", value: fmtN(totalCustomers) },
        ]}
      />
      <ReportTable
        columns={cols}
        rows={exhibitions as unknown as Record<string, unknown>[]}
        totalRow={{ name: "TOTAL", interestCount: totalInterests, uniqueSkuCount: totalSkus, customerCount: totalCustomers } as unknown as Record<string, unknown>}
      />
      <ExportBar
        filename="exhibition-report.csv"
        headers={["Exhibition", "Interest Count", "Unique SKUs", "Customers"]}
        rows={exhibitions.map((e) => [e.name, e.interestCount, e.uniqueSkuCount, e.customerCount])}
      />
    </>
  );
}

function CrossAnalysisReport() {
  const { inventory, sales } = useReportsData();
  // Margin by category
  const marginByCat = useMemo(() => {
    const map = new Map<string, { count: number; totalGP: number; totalCost: number; totalTag: number }>();
    for (const item of inventory) {
      if (item.status !== "On Hand") continue;
      const cat = item.catSimple || item.category || "Other";
      const entry = map.get(cat) || { count: 0, totalGP: 0, totalCost: 0, totalTag: 0 };
      entry.count += 1;
      entry.totalGP += item.gp;
      entry.totalCost += item.costPrice;
      entry.totalTag += item.tagPrice;
      map.set(cat, entry);
    }
    return Array.from(map.entries())
      .map(([cat, d]) => ({
        category: cat,
        count: d.count,
        avgGP: d.count ? d.totalGP / d.count : 0,
        costValue: d.totalCost,
        tagValue: d.totalTag,
        margin: d.totalTag ? ((d.totalTag - d.totalCost) / d.totalTag) * 100 : 0,
      }))
      .sort((a, b) => b.margin - a.margin);
  }, [inventory]);

  // Working capital analysis by location (live, dead = ageing > 365 days)
  const workingCapital = useMemo(() => {
    const map = new Map<string, { total_cost: number; dead_cost: number; ageingSum: number; count: number }>();
    for (const item of inventory) {
      if (item.status !== "On Hand") continue;
      const e = map.get(item.location) || { total_cost: 0, dead_cost: 0, ageingSum: 0, count: 0 };
      e.total_cost += item.costPrice;
      e.ageingSum += item.ageingDays;
      e.count += 1;
      if (item.ageingDays > 365) e.dead_cost += item.costPrice;
      map.set(item.location, e);
    }
    return Array.from(map.entries())
      .map(([location, d]) => {
        const deadPct = d.total_cost > 0 ? (d.dead_cost / d.total_cost) * 100 : 0;
        return {
          location,
          totalCost: d.total_cost,
          deadCost: d.dead_cost,
          deadPct,
          avgAgeing: d.count ? d.ageingSum / d.count : 0,
          utilScore: 100 - deadPct,
        };
      })
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [inventory]);

  // Demand-supply: compare sales velocity vs stock
  const demandSupply = useMemo(() => {
    const salesByCat = new Map<string, number>();
    for (const s of sales) {
      const cat = s.category || "Other";
      salesByCat.set(cat, (salesByCat.get(cat) || 0) + 1);
    }
    const stockByCat = new Map<string, number>();
    for (const item of inventory) {
      if (item.status !== "On Hand") continue;
      const cat = item.catSimple || item.category || "Other";
      stockByCat.set(cat, (stockByCat.get(cat) || 0) + 1);
    }
    const allCats = new Set(Array.from(salesByCat.keys()).concat(Array.from(stockByCat.keys())));
    return Array.from(allCats)
      .map((cat) => ({
        category: cat,
        sold: salesByCat.get(cat) || 0,
        stock: stockByCat.get(cat) || 0,
        ratio: (stockByCat.get(cat) || 0) > 0
          ? ((salesByCat.get(cat) || 0) / (stockByCat.get(cat) || 1)).toFixed(2)
          : "N/A",
      }))
      .sort((a, b) => b.sold - a.sold);
  }, [inventory, sales]);

  const marginCols: TableColumn[] = [
    { header: "Category", accessor: (r) => String(r.category) },
    { header: "Count", accessor: (r) => fmtN(r.count as number), align: "right" },
    { header: "Cost Value", accessor: (r) => fmt(r.costValue as number), align: "right" },
    { header: "Tag Value", accessor: (r) => fmt(r.tagValue as number), align: "right" },
    { header: "Avg GP%", accessor: (r) => (r.avgGP as number).toFixed(1) + "%", align: "right" },
    { header: "Margin%", accessor: (r) => (r.margin as number).toFixed(1) + "%", align: "right" },
  ];

  const wcCols: TableColumn[] = [
    { header: "Location", accessor: (r) => String(r.location) },
    { header: "Total Cost", accessor: (r) => fmt(r.totalCost as number), align: "right" },
    { header: "Dead Cost", accessor: (r) => fmt(r.deadCost as number), align: "right" },
    { header: "Dead %", accessor: (r) => (r.deadPct as number).toFixed(1) + "%", align: "right" },
    { header: "Avg Ageing", accessor: (r) => fmtN(Math.round(r.avgAgeing as number)) + "d", align: "right" },
    { header: "Util Score", accessor: (r) => (r.utilScore as number).toFixed(1), align: "right" },
  ];

  const dsCols: TableColumn[] = [
    { header: "Category", accessor: (r) => String(r.category) },
    { header: "Units Sold", accessor: (r) => fmtN(r.sold as number), align: "right" },
    { header: "On-Hand Stock", accessor: (r) => fmtN(r.stock as number), align: "right" },
    { header: "Sales/Stock Ratio", accessor: (r) => String(r.ratio), align: "right" },
  ];

  const totalCost = workingCapital.reduce((s, w) => s + w.totalCost, 0);
  const totalDead = workingCapital.reduce((s, w) => s + w.deadCost, 0);

  return (
    <>
      <SummaryBar
        stats={[
          { label: "Categories", value: String(marginByCat.length) },
          { label: "Working Capital", value: fmt(totalCost) },
          { label: "Dead Capital", value: fmt(totalDead) },
          { label: "Dead Capital %", value: totalCost ? ((totalDead / totalCost) * 100).toFixed(1) + "%" : "---" },
        ]}
      />

      <div className="mb-6">
        <h4
          className="text-[11px] tracking-[1.5px] uppercase px-3 py-2"
          style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
        >
          MARGIN BY CATEGORY
        </h4>
        <ReportTable columns={marginCols} rows={marginByCat as unknown as Record<string, unknown>[]} />
      </div>

      <div className="mb-6">
        <h4
          className="text-[11px] tracking-[1.5px] uppercase px-3 py-2"
          style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
        >
          WORKING CAPITAL BY LOCATION
        </h4>
        <ReportTable columns={wcCols} rows={workingCapital as unknown as Record<string, unknown>[]} />
      </div>

      <div>
        <h4
          className="text-[11px] tracking-[1.5px] uppercase px-3 py-2"
          style={{ fontFamily: "'DM Mono', monospace", color: "#6B6458" }}
        >
          DEMAND-SUPPLY CORRELATION
        </h4>
        <ReportTable columns={dsCols} rows={demandSupply as unknown as Record<string, unknown>[]} />
      </div>
    </>
  );
}

// --------------------------------------------------------------------------
// Export bar
// --------------------------------------------------------------------------

function ExportBar({
  filename,
  headers,
  rows,
}: {
  filename: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  const handleCSV = () => downloadCSV(filename, headers, rows);
  const handlePrint = () => window.print();
  const handleExcel = () => {
    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, filename.replace(".csv", ".xlsx"));
  };

  return (
    <div className="flex items-center gap-3 mt-4 pt-4 border-t border-[#EDE7D8]">
      <button
        onClick={handleCSV}
        className="px-4 py-1.5 text-[11px] border border-[#D4C9A8] rounded-md bg-white text-[#3D3830] hover:bg-[#F5F1E8] transition-colors"
        style={{ fontFamily: "'DM Mono', monospace" }}
      >
        Export CSV
      </button>
      <button
        onClick={handleExcel}
        className="px-4 py-1.5 text-[11px] border border-[#4A7C59] rounded-md bg-[#E8F5EC] text-[#2D6B42] hover:bg-[#D0E8D5] transition-colors"
        style={{ fontFamily: "'DM Mono', monospace" }}
      >
        Export Excel
      </button>
      <button
        onClick={handlePrint}
        className="px-4 py-1.5 text-[11px] border border-[#D4C9A8] rounded-md bg-white text-[#3D3830] hover:bg-[#F5F1E8] transition-colors"
        style={{ fontFamily: "'DM Mono', monospace" }}
      >
        Print
      </button>
    </div>
  );
}

// --------------------------------------------------------------------------
// Main Reports page
// --------------------------------------------------------------------------

export default function ReportsPage() {
  const [selectedReport, setSelectedReport] = useState<ReportKey | null>(null);
  const [gpMin, setGpMin] = useState<string>("");
  const [gpMax, setGpMax] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // ── Live data sources ──
  const { data: stockData, isLoading: stockLoading } = useQuery({
    queryKey: ["stock-items", "On Hand", 5000],
    queryFn: () => fetchStockItems({ status: "On Hand", limit: 5000 }),
  });
  const { data: memoData, isLoading: memoLoading } = useQuery({
    queryKey: ["stock-items", "Memo", 5000],
    queryFn: () => fetchStockItems({ status: "Memo", limit: 5000 }),
  });
  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ["sales-data"],
    queryFn: fetchSalesData,
    staleTime: 15 * 60 * 1000,
  });
  const { data: exhibitionData } = useQuery({
    queryKey: ["exhibition-list"],
    queryFn: fetchExhibitionList,
  });

  const reportsData = useMemo<ReportsData>(() => {
    const inventory = (stockData?.items ?? []).map(liveToInventoryItem);
    const sales = liveToSalesTransactions(salesData?.sales ?? []);
    const memoItems: MemoLite[] = (memoData?.items ?? []).map((i) => ({
      salesPerson: i.memoSalesPersonName ?? "",
      tagPrice: i.tagPrice,
    }));
    const exhibitions = exhibitionData?.exhibitions ?? [];
    const onHandCount = inventory.filter((i) => i.status === "On Hand").length;

    // Peak month from live sales
    const monthMap = new Map<string, number>();
    for (const s of sales) {
      const mk = s.transDate ? s.transDate.slice(0, 7) : "";
      if (mk) monthMap.set(mk, (monthMap.get(mk) || 0) + s.transPrice);
    }
    let peakMonth = "—";
    let peakRevenue = 0;
    Array.from(monthMap.entries()).forEach(([mk, rev]) => {
      if (rev > peakRevenue) {
        peakRevenue = rev;
        peakMonth = MONTH_NAMES[mk] || mk;
      }
    });

    return { inventory, sales, memoItems, exhibitions, onHandCount, peakMonth, peakRevenue };
  }, [stockData, memoData, salesData, exhibitionData]);

  const isLoading = stockLoading || salesLoading || memoLoading;

  const reportKeys = Object.keys(REPORT_DEFS) as ReportKey[];

  function renderReport(key: ReportKey) {
    switch (key) {
      case "topselling":
        return <TopSellingReport />;
      case "deadstock":
        return <DeadStockReport />;
      case "ageing":
        return <AgeingReport />;
      case "margin":
        return <MarginReport />;
      case "assortment":
        return <AssortmentMixReport />;
      case "client":
        return <ClientReport />;
      case "channel":
        return <ChannelReport />;
      case "monthly":
        return <MonthlyReport />;
      case "bdmperf":
        return <BdmPerfReport />;
      case "exhibition":
        return <ExhibitionReport />;
      case "crossreport":
        return <CrossAnalysisReport />;
      default:
        return null;
    }
  }

  return (
    <ReportsDataContext.Provider value={reportsData}>
      <div>
      <div style={{ height: 2, background: "linear-gradient(90deg, #C9A84C, transparent)", marginBottom: 20, borderRadius: 1 }} />
      {/* Report cards grid */}
      <div className="grid grid-cols-4 gap-[14px] mb-6">
        {reportKeys.map((key) => {
          const def = REPORT_DEFS[key];
          const isActive = selectedReport === key;
          return (
            <button
              key={key}
              onClick={() => setSelectedReport(key)}
              className={cn(
                "bg-white border rounded-lg p-[18px] cursor-pointer text-left transition",
                "hover:border-[#C9A84C] hover:shadow",
                isActive
                  ? "border-[#C9A84C] bg-[rgba(201,168,76,0.05)]"
                  : "border-[#D4C9A8]"
              )}
            >
              <span className="text-2xl mb-2 block">{def.icon}</span>
              <p
                className="text-[15px] font-medium mb-1"
                style={{ fontFamily: "'Jost', sans-serif", color: "#1A1814" }}
              >
                {def.title}
              </p>
              <p
                className="text-[11.5px]"
                style={{ color: "#6B6458" }}
              >
                {def.desc}
              </p>
            </button>
          );
        })}
      </div>

      {/* Report viewer */}
      {selectedReport ? (
        <div className="bg-white border border-[#D4C9A8] rounded-lg overflow-hidden">
          {/* Title bar */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#D4C9A8] bg-white">
            <div className="flex items-center gap-3">
              <span className="text-xl">{REPORT_DEFS[selectedReport].icon}</span>
              <h3
                className="text-lg font-semibold"
                style={{ fontFamily: "'Jost', sans-serif", color: "#1A1814" }}
              >
                {REPORT_DEFS[selectedReport].title}
              </h3>
            </div>
            <button
              onClick={() => setSelectedReport(null)}
              className="text-[11px] px-3 py-1 border border-[#D4C9A8] rounded-md text-[#6B6458] hover:bg-[#F5F1E8] transition-colors"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              Close
            </button>
          </div>

          {/* Filter toolbar */}
          <div className="flex items-center gap-3 px-5 py-2.5 border-b border-[#EDE7D8] bg-[#FAFAF5]">
            <span className="text-[9px] uppercase tracking-[1.5px] text-[#6B6458] mr-1" style={{ fontFamily: "'DM Mono', monospace" }}>
              Filters
            </span>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-[#6B6458]" style={{ fontFamily: "'DM Mono', monospace" }}>GP%</label>
              <input
                type="number"
                placeholder="Min"
                value={gpMin}
                onChange={(e) => setGpMin(e.target.value)}
                className="w-[60px] h-7 text-[11px] px-2 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
                style={{ fontFamily: "'DM Mono', monospace" }}
              />
              <span className="text-[10px] text-[#6B6458]">–</span>
              <input
                type="number"
                placeholder="Max"
                value={gpMax}
                onChange={(e) => setGpMax(e.target.value)}
                className="w-[60px] h-7 text-[11px] px-2 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
                style={{ fontFamily: "'DM Mono', monospace" }}
              />
            </div>
            <div className="w-px h-5 bg-[#D4C9A8]" />
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-[#6B6458]" style={{ fontFamily: "'DM Mono', monospace" }}>Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-7 text-[11px] px-2 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
                style={{ fontFamily: "'DM Mono', monospace" }}
              />
              <span className="text-[10px] text-[#6B6458]">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-7 text-[11px] px-2 border border-[#D4C9A8] rounded bg-white focus:border-[#C9A84C] focus:outline-none"
                style={{ fontFamily: "'DM Mono', monospace" }}
              />
            </div>
            {(gpMin || gpMax || dateFrom || dateTo) && (
              <button
                onClick={() => { setGpMin(""); setGpMax(""); setDateFrom(""); setDateTo(""); }}
                className="text-[10px] text-[#A63C2A] hover:text-[#A63C2A]/80 ml-auto"
                style={{ fontFamily: "'DM Mono', monospace" }}
              >
                Clear Filters
              </button>
            )}
          </div>

          {/* Report content */}
          <div>
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <p className="text-[13px] text-[#6B6458]" style={{ fontFamily: "'DM Mono', monospace" }}>
                  Loading live data...
                </p>
              </div>
            ) : (
              renderReport(selectedReport)
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-40 rounded-lg border border-dashed border-[#D4C9A8]">
          <p
            className="text-[#1A1814]/40 text-sm"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            Select a report above to view details
          </p>
        </div>
      )}
      </div>
    </ReportsDataContext.Provider>
  );
}
