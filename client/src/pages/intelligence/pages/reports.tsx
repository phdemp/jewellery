import { useState, useMemo } from "react";
import { DATA, EXHIBITION_DATA } from "../lib/intelligence-data";
import { fmt, fmtN, ageTagClass, downloadCSV, getPriceBand } from "../lib/intelligence-utils";
import { REPORT_DEFS, MONTH_NAMES, AGEING_RANGES } from "../lib/intelligence-constants";
import { cn } from "@/lib/utils";
import type { InventoryItem, SalesTransaction, MemoItem } from "../lib/intelligence-types";

type ReportKey = keyof typeof REPORT_DEFS;

// Cast as-const arrays to mutable interface types for iteration safety
const inventory = DATA.inventory as unknown as InventoryItem[];
const sales = DATA.sales as unknown as SalesTransaction[];
const memoItems = DATA.memoItems as unknown as MemoItem[];

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
            style={{ fontFamily: "'Cormorant Garamond', serif", color: "#1A1814" }}
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
  }, []);

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
  const items = useMemo(
    () => [...DATA.deadStock].sort((a, b) => b["Ageing Days"] - a["Ageing Days"]),
    []
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
          { label: "% of Inventory", value: ((items.length / DATA.summary.onHand) * 100).toFixed(1) + "%" },
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
  const buckets = DATA.ageing;
  const totalCount = buckets.reduce((s, b) => s + b.count, 0);
  const totalCost = buckets.reduce((s, b) => s + b.cost_val, 0);
  const totalTag = buckets.reduce((s, b) => s + b.tag_val, 0);

  // Location breakdown by ageing
  const locBreakdown = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const item of inventory) {
      if (item.status !== "On Hand") continue;
      const loc = item.location;
      if (!map.has(loc)) map.set(loc, { Fresh: 0, Watch: 0, Slow: 0, "Dead Stock": 0 });
      const entry = map.get(loc)!;
      entry[item.ageingTag] = (entry[item.ageingTag] || 0) + 1;
    }
    return Array.from(map.entries()).map(([loc, counts]) => ({ location: loc, ...counts }));
  }, []);

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
    { header: "Watch", accessor: (r) => fmtN(r.Watch as number), align: "right" },
    { header: "Slow", accessor: (r) => fmtN(r.Slow as number), align: "right" },
    { header: "Dead Stock", accessor: (r) => fmtN(r["Dead Stock"] as number), align: "right" },
  ];

  return (
    <>
      <SummaryBar
        stats={[
          { label: "Total On-Hand", value: String(totalCount) },
          { label: "Total Cost", value: fmt(totalCost) },
          { label: "Total Tag", value: fmt(totalTag) },
          { label: "Dead Stock %", value: totalCount ? ((buckets.find((b) => b["Ageing Tag"] === "Dead Stock")?.count || 0) / totalCount * 100).toFixed(1) + "%" : "---" },
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
  const items = useMemo(
    () => [...DATA.highMargin].sort((a, b) => b.GP_pct - a.GP_pct),
    []
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
  }, []);

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
  const clients = useMemo(() => {
    return DATA.clientDetail
      .filter((c) => c.txnCount > 0)
      .sort((a, b) => b.totalSpend - a.totalSpend)
      .slice(0, 50);
  }, []);

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
    { header: "Avg GP%", accessor: (r) => (r.avgGP as number).toFixed(1) + "%", align: "right" },
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
                  <td className="px-3 py-2 text-[12.5px] border-b border-[#EDE7D8] text-right" style={{ color: "#3D3830" }}>{c.avgGP.toFixed(1)}%</td>
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
        headers={["Client Name", "Total Spend", "Transactions", "Avg Order", "Avg GP%", "Segment"]}
        rows={clients.map((c) => [c.name, c.totalSpend, c.txnCount, c.avgOrder, c.avgGP, clientTag(c)])}
      />
    </>
  );
}

function ChannelReport() {
  const channels = useMemo(
    () => [...DATA.salesChannel].sort((a, b) => b.revenue - a.revenue),
    []
  );
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
                    <div className="w-full bg-[#F5F1E8] rounded-full h-2">
                      <div
                        className="h-2 rounded-full"
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
  const months = DATA.monthly;
  const totalRevenue = months.reduce((s, m) => s + m.revenue, 0);
  const avgRevenue = months.length ? totalRevenue / months.length : 0;
  const maxRevenue = Math.max(...months.map((m) => m.revenue));

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
          { label: "Peak Month", value: DATA.summary.peakMonth },
          { label: "Peak Revenue", value: fmt(DATA.summary.peakRevenue) },
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
                  <div className="w-full bg-[#F5F1E8] rounded-full h-2">
                    <div
                      className="h-2 rounded-full"
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
  const bdms = useMemo(
    () => [...DATA.bdmPerformance].sort((a, b) => b.revenue - a.revenue),
    []
  );
  const totalRevenue = bdms.reduce((s, b) => s + b.revenue, 0);
  const totalSold = bdms.reduce((s, b) => s + b.sold_count, 0);
  const totalClients = bdms.reduce((s, b) => s + b.clients, 0);
  const maxRevenue = bdms.length ? bdms[0].revenue : 1;

  // Memo summary per BDM
  const memoByBdm = useMemo(() => {
    const map = new Map<string, { count: number; value: number }>();
    for (const m of memoItems) {
      const key = m.bdm || m.salesPerson;
      if (!key || key === "nan") continue;
      const entry = map.get(key) || { count: 0, value: 0 };
      entry.count += 1;
      entry.value += m.tagPrice;
      map.set(key, entry);
    }
    return map;
  }, []);

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
                    <div className="w-full bg-[#F5F1E8] rounded-full h-2">
                      <div className="h-2 rounded-full" style={{ width: barWidth + "%", backgroundColor: "#C9A84C" }} />
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
  const exhibitions = EXHIBITION_DATA.exhibitions;
  const totalInterests = EXHIBITION_DATA.totalInterests;
  const totalSkus = EXHIBITION_DATA.totalUniqueSkus;
  const totalTag = EXHIBITION_DATA.totalTagValue;

  const cols: TableColumn[] = [
    { header: "Exhibition", accessor: (r) => String(r.name) },
    { header: "Type", accessor: (r) => String(r.type) },
    { header: "Interest Count", accessor: (r) => fmtN(r.interestCount as number), align: "right" },
    { header: "Unique SKUs", accessor: (r) => fmtN(r.uniqueSkuCount as number), align: "right" },
    { header: "Tag Value", accessor: (r) => fmt(r.totalTagValue as number), align: "right" },
  ];

  return (
    <>
      <SummaryBar
        stats={[
          { label: "Exhibitions", value: String(exhibitions.length) },
          { label: "Total Interests", value: fmtN(totalInterests) },
          { label: "Unique SKUs", value: fmtN(totalSkus) },
          { label: "Total Tag Value", value: fmt(totalTag) },
        ]}
      />
      <ReportTable
        columns={cols}
        rows={exhibitions as unknown as Record<string, unknown>[]}
        totalRow={{ name: "TOTAL", type: "", interestCount: totalInterests, uniqueSkuCount: totalSkus, totalTagValue: totalTag } as unknown as Record<string, unknown>}
      />
      <ExportBar
        filename="exhibition-report.csv"
        headers={["Exhibition", "Type", "Interest Count", "Unique SKUs", "Tag Value"]}
        rows={exhibitions.map((e) => [e.name, e.type, e.interestCount, e.uniqueSkuCount, e.totalTagValue])}
      />
    </>
  );
}

function CrossAnalysisReport() {
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
  }, []);

  // Working capital analysis by location
  const workingCapital = useMemo(() => {
    return DATA.locUtilization.map((loc) => ({
      location: loc["Location Name"],
      totalCost: loc.total_cost,
      deadCost: loc.dead_cost,
      deadPct: loc.dead_pct,
      avgAgeing: loc.avg_ageing,
      utilScore: loc.utilization_score,
    }));
  }, []);

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
  }, []);

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
    <div>
      {/* Report cards grid */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {reportKeys.map((key) => {
          const def = REPORT_DEFS[key];
          const isActive = selectedReport === key;
          return (
            <button
              key={key}
              onClick={() => setSelectedReport(key)}
              className={cn(
                "bg-white border rounded-lg p-5 cursor-pointer text-left transition",
                "hover:border-[#C9A84C] hover:shadow",
                isActive
                  ? "border-[#C9A84C] bg-[rgba(201,168,76,0.05)]"
                  : "border-[#D4C9A8]"
              )}
            >
              <span className="text-2xl mb-2 block">{def.icon}</span>
              <p
                className="text-[15px] font-medium mb-1"
                style={{ fontFamily: "'Cormorant Garamond', serif", color: "#1A1814" }}
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
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#D4C9A8] bg-[#FAF7F0]">
            <div className="flex items-center gap-3">
              <span className="text-xl">{REPORT_DEFS[selectedReport].icon}</span>
              <h3
                className="text-lg font-semibold"
                style={{ fontFamily: "'Cormorant Garamond', serif", color: "#1A1814" }}
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

          {/* Report content */}
          <div>{renderReport(selectedReport)}</div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-40 rounded-lg border border-dashed border-[#E8E0D0]">
          <p
            className="text-[#1A1814]/40 text-sm"
            style={{ fontFamily: "'DM Mono', monospace" }}
          >
            Select a report above to view details
          </p>
        </div>
      )}
    </div>
  );
}
