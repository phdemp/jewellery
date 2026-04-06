import { useState, useEffect, useCallback } from "react";
import { Layout } from "@/components/layout";
import { OrnamentalDivider } from "@/components/ornamental-divider";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  getAssortmentBdmList,
  getAssortmentBdmProfile,
  generateAssortmentRecommendations,
  importAssortmentSales,
  importAssortmentStock,
  startStockEmbedding,
  getStockEmbeddingStatus,
  getAssortmentImportStatus,
  saveAssortmentPlan,
  type AssortmentRecommendation,
  type AssortmentRecommendationResponse,
  type StockItemSummary,
  type EmbedStockStatus,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Package, BarChart3, Upload, Cpu, Save, ArrowLeftRight, ChevronDown, ChevronUp } from "lucide-react";

function formatCurrency(amount: number): string {
  if (amount >= 10_000_000) return `${(amount / 10_000_000).toFixed(1)} Cr`;
  if (amount >= 100_000) return `${(amount / 100_000).toFixed(1)} L`;
  return `${amount.toLocaleString("en-IN")}`;
}

function StockImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [error, setError] = useState(false);
  if (!src || error) {
    return (
      <div className={cn("bg-muted flex items-center justify-center text-muted-foreground text-xs", className)}>
        <Package className="w-8 h-8 opacity-30" />
      </div>
    );
  }
  return <img src={src} alt={alt} className={cn("object-cover", className)} onError={() => setError(true)} />;
}

export default function AssortmentPage() {
  const { toast } = useToast();

  // BDM state
  const [bdmNames, setBdmNames] = useState<string[]>([]);
  const [selectedBdm, setSelectedBdm] = useState("");
  const [bdmSearch, setBdmSearch] = useState("");
  const [showBdmDropdown, setShowBdmDropdown] = useState(false);

  // Profile & recommendations
  const [profile, setProfile] = useState<AssortmentRecommendationResponse["profile"] | null>(null);
  const [recommendations, setRecommendations] = useState<AssortmentRecommendation[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Swap dialog
  const [swapCatIndex, setSwapCatIndex] = useState<number | null>(null);

  // Selected items for saving (category index → item id)
  const [selectedItems, setSelectedItems] = useState<Map<number, StockItemSummary>>(new Map());

  // Admin panel
  const [adminOpen, setAdminOpen] = useState(false);
  const [importing, setImporting] = useState<"sales" | "stock" | null>(null);
  const [importStatus, setImportStatus] = useState<{ salesCount: number; stockCount: number; embeddedCount: number } | null>(null);
  const [embedStatus, setEmbedStatus] = useState<EmbedStockStatus | null>(null);
  const [embedPolling, setEmbedPolling] = useState(false);

  // Load BDM names on mount
  useEffect(() => {
    getAssortmentBdmList().then(r => setBdmNames(r.bdmNames)).catch(() => {});
    getAssortmentImportStatus().then(setImportStatus).catch(() => {});
  }, []);

  // Poll embedding status
  useEffect(() => {
    if (!embedPolling) return;
    const interval = setInterval(async () => {
      try {
        const status = await getStockEmbeddingStatus();
        setEmbedStatus(status);
        if (!status.running) {
          setEmbedPolling(false);
          getAssortmentImportStatus().then(setImportStatus).catch(() => {});
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [embedPolling]);

  const handleGenerateRecommendations = useCallback(async () => {
    if (!selectedBdm) return;
    setIsLoading(true);
    setRecommendations([]);
    setProfile(null);
    setSelectedItems(new Map());
    try {
      const result = await generateAssortmentRecommendations(selectedBdm);
      setProfile(result.profile);
      setRecommendations(result.recommendations);
      // Pre-select the suggested items
      const initial = new Map<number, StockItemSummary>();
      result.recommendations.forEach((r, i) => {
        if (r.suggested) initial.set(i, r.suggested);
      });
      setSelectedItems(initial);
      toast({ title: "Recommendations Ready", description: `${result.recommendations.length} categories analyzed for ${selectedBdm}` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to generate recommendations";
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [selectedBdm, toast]);

  const handleSwap = (catIndex: number, item: StockItemSummary) => {
    setSelectedItems(prev => {
      const next = new Map(prev);
      next.set(catIndex, item);
      return next;
    });
    setSwapCatIndex(null);
  };

  const handleSavePlan = async () => {
    const ids = Array.from(selectedItems.values()).map(i => i.id);
    if (ids.length === 0) {
      toast({ title: "Nothing to save", description: "No items selected", variant: "destructive" });
      return;
    }
    try {
      await saveAssortmentPlan(selectedBdm, ids);
      toast({ title: "Plan Saved", description: `Saved ${ids.length} items for ${selectedBdm}` });
    } catch {
      toast({ title: "Error", description: "Failed to save plan", variant: "destructive" });
    }
  };

  const handleImport = async (type: "sales" | "stock") => {
    setImporting(type);
    try {
      const result = type === "sales" ? await importAssortmentSales() : await importAssortmentStock();
      toast({ title: "Import Complete", description: `Imported ${result.imported} ${type} records from "${result.sheet}"` });
      getAssortmentImportStatus().then(setImportStatus).catch(() => {});
      if (type === "sales") {
        getAssortmentBdmList().then(r => setBdmNames(r.bdmNames)).catch(() => {});
      }
    } catch {
      toast({ title: "Error", description: `Failed to import ${type} data`, variant: "destructive" });
    } finally {
      setImporting(null);
    }
  };

  const handleStartEmbedding = async () => {
    try {
      await startStockEmbedding();
      setEmbedPolling(true);
      toast({ title: "Embedding Started", description: "Processing stock items in background..." });
    } catch {
      toast({ title: "Error", description: "Failed to start embedding", variant: "destructive" });
    }
  };

  const filteredBdmNames = bdmSearch
    ? bdmNames.filter(n => n.toLowerCase().includes(bdmSearch.toLowerCase()))
    : bdmNames;

  const totalSelectedValue = Array.from(selectedItems.values()).reduce((s, i) => s + (i.tagPrice || 0), 0);

  return (
    <Layout>
      {/* Hero */}
      <div className="text-center mb-8">
        <h1 className="font-serif text-3xl md:text-4xl font-semibold text-primary tracking-wide">
          Assortment Planning
        </h1>
        <OrnamentalDivider />
        <p className="text-muted-foreground mt-2 max-w-2xl mx-auto">
          Shipment recommendations based on BDM sales patterns and stock price matching
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* ── LEFT PANEL ── */}
        <div className="lg:col-span-4 space-y-6">
          {/* BDM Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-primary" />
                BDM Selection
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search BDM name..."
                  value={bdmSearch}
                  onChange={e => { setBdmSearch(e.target.value); setShowBdmDropdown(true); }}
                  onFocus={() => setShowBdmDropdown(true)}
                  className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                />
                {showBdmDropdown && filteredBdmNames.length > 0 && (
                  <div className="absolute z-20 w-full mt-1 max-h-48 overflow-y-auto bg-background border rounded-md shadow-lg">
                    {filteredBdmNames.map(name => (
                      <button
                        key={name}
                        onClick={() => {
                          setSelectedBdm(name);
                          setBdmSearch(name);
                          setShowBdmDropdown(false);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors",
                          name === selectedBdm && "bg-primary/10 text-primary font-medium"
                        )}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedBdm && (
                <Button onClick={handleGenerateRecommendations} disabled={isLoading} className="w-full">
                  {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Cpu className="w-4 h-4 mr-2" />}
                  Generate Recommendations
                </Button>
              )}
            </CardContent>
          </Card>

          {/* BDM Profile */}
          {profile && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{profile.bdmName}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Sales</span>
                  <span className="font-medium">{profile.totalSales}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Revenue</span>
                  <span className="font-medium">{formatCurrency(profile.totalRevenue)}</span>
                </div>
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-2">Top Categories</p>
                  <div className="space-y-1">
                    {profile.topCategories.slice(0, 5).map(cat => (
                      <div key={cat.category} className="flex items-center justify-between text-sm">
                        <span>{cat.category}</span>
                        <Badge variant="secondary" className="text-xs">{cat.count}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Admin Panel */}
          <Card>
            <CardHeader className="cursor-pointer" onClick={() => setAdminOpen(!adminOpen)}>
              <CardTitle className="text-lg flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Upload className="w-5 h-5 text-primary" />
                  Data Import
                </span>
                {adminOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </CardTitle>
            </CardHeader>
            {adminOpen && (
              <CardContent className="space-y-3">
                {importStatus && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    <p>Sales: {importStatus.salesCount.toLocaleString()} records</p>
                    <p>Stock: {importStatus.stockCount.toLocaleString()} items</p>
                    <p>Embedded: {importStatus.embeddedCount.toLocaleString()} items</p>
                  </div>
                )}
                <Button
                  variant="outline" size="sm" className="w-full"
                  onClick={() => handleImport("sales")}
                  disabled={importing !== null}
                >
                  {importing === "sales" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Import Sales Data
                </Button>
                <Button
                  variant="outline" size="sm" className="w-full"
                  onClick={() => handleImport("stock")}
                  disabled={importing !== null}
                >
                  {importing === "stock" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Import Stock Data
                </Button>
                <Button
                  variant="outline" size="sm" className="w-full"
                  onClick={handleStartEmbedding}
                  disabled={embedPolling}
                >
                  {embedPolling ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Cpu className="w-4 h-4 mr-2" />}
                  Generate Embeddings
                </Button>
                {embedStatus && embedStatus.total > 0 && (
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{embedStatus.processed} / {embedStatus.total}</span>
                      <span>{embedStatus.failed > 0 ? `${embedStatus.failed} failed` : ""}</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all duration-300"
                        style={{ width: `${Math.round((embedStatus.processed / embedStatus.total) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        </div>

        {/* ── RIGHT PANEL ── */}
        <div className="lg:col-span-8 space-y-6">
          {/* Loading state */}
          {isLoading && (
            <Card>
              <CardContent className="py-16 text-center">
                <Loader2 className="w-12 h-12 mx-auto mb-4 animate-spin text-primary" />
                <p className="text-lg font-medium">Analyzing {selectedBdm}'s sales patterns...</p>
                <p className="text-sm text-muted-foreground mt-1">Matching with inventory by category &amp; price</p>
              </CardContent>
            </Card>
          )}

          {/* Empty state */}
          {!isLoading && recommendations.length === 0 && (
            <Card>
              <CardContent className="py-16 text-center">
                <Package className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
                <p className="text-lg font-medium text-muted-foreground">Select a BDM to get started</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Choose a BDM from the dropdown and generate AI recommendations
                </p>
              </CardContent>
            </Card>
          )}

          {/* Recommendation cards */}
          {recommendations.map((rec, catIndex) => {
            const current = selectedItems.get(catIndex) || rec.suggested;
            return (
              <Card key={catIndex}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center justify-between">
                    <span>{rec.category}</span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{rec.salesCount} past sales</Badge>
                      <Badge variant="secondary" className="text-xs">{rec.alternatives.length + (rec.suggested ? 1 : 0)} in stock</Badge>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {current ? (
                    <div className="flex flex-col md:flex-row gap-4">
                      {/* Main suggested item */}
                      <div className="md:w-48 flex-shrink-0">
                        <StockImage
                          src={current.imageUrl}
                          alt={current.jewelCode}
                          className="w-full aspect-square rounded-lg"
                        />
                      </div>
                      <div className="flex-1 space-y-2">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">Suggested to Ship</p>
                        <p className="font-medium">{current.jewelCode}</p>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-muted-foreground">Style: </span>
                            <span>{current.styleNo}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Price: </span>
                            <span>{current.tagPrice ? formatCurrency(current.tagPrice) : "N/A"}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Price Match: </span>
                            <Badge variant="secondary" className="text-xs">
                              {(current.priceMatch * 100).toFixed(0)}%
                            </Badge>
                          </div>
                          {current.grossWt && (
                            <div>
                              <span className="text-muted-foreground">Gross Wt: </span>
                              <span>{current.grossWt}g</span>
                            </div>
                          )}
                          {current.collectionName && (
                            <div>
                              <span className="text-muted-foreground">Collection: </span>
                              <span>{current.collectionName}</span>
                            </div>
                          )}
                          {current.subCategory && (
                            <div>
                              <span className="text-muted-foreground">Sub-Cat: </span>
                              <span>{current.subCategory}</span>
                            </div>
                          )}
                        </div>
                        {rec.alternatives.length > 0 && (
                          <Button
                            variant="outline" size="sm"
                            onClick={() => setSwapCatIndex(catIndex)}
                          >
                            <ArrowLeftRight className="w-4 h-4 mr-1" />
                            Swap ({rec.alternatives.length} alternatives)
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No matching stock items found for this category</p>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {/* Bottom bar */}
          {recommendations.length > 0 && (
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="py-4 flex items-center justify-between">
                <div className="text-sm space-x-4">
                  <span><strong>{selectedItems.size}</strong> items selected</span>
                  <span>Total value: <strong>{formatCurrency(totalSelectedValue)}</strong></span>
                </div>
                <Button onClick={handleSavePlan} disabled={selectedItems.size === 0}>
                  <Save className="w-4 h-4 mr-2" />
                  Save Plan
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Swap dialog */}
      <Dialog open={swapCatIndex !== null} onOpenChange={() => setSwapCatIndex(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {swapCatIndex !== null && recommendations[swapCatIndex]
                ? `Alternatives — ${recommendations[swapCatIndex].category}`
                : "Alternatives"}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
            {swapCatIndex !== null && recommendations[swapCatIndex]?.alternatives.map(alt => {
              const isSelected = selectedItems.get(swapCatIndex)?.id === alt.id;
              return (
                <button
                  key={alt.id}
                  onClick={() => handleSwap(swapCatIndex, alt)}
                  className={cn(
                    "border rounded-lg p-2 text-left transition-all hover:border-primary/50",
                    isSelected && "border-primary ring-2 ring-primary/20"
                  )}
                >
                  <StockImage
                    src={alt.imageUrl}
                    alt={alt.jewelCode}
                    className="w-full aspect-square rounded"
                  />
                  <p className="text-sm font-medium mt-2 truncate">{alt.jewelCode}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-muted-foreground">
                      {alt.tagPrice ? formatCurrency(alt.tagPrice) : "N/A"}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {(alt.priceMatch * 100).toFixed(0)}%
                    </Badge>
                  </div>
                  {alt.grossWt && (
                    <p className="text-xs text-muted-foreground mt-0.5">{alt.grossWt}g</p>
                  )}
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
