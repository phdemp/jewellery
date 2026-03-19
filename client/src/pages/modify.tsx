import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { Layout } from "@/components/layout";
import { OrnamentalDivider } from "@/components/ornamental-divider";
import { ResultDisplay } from "@/components/result-display";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { modifyDesign, type ModifyDesignParams, type ModifyDesignResponse, SEGMENT_CATEGORY_PRICE_MAP } from "@/lib/api";
import { Loader2, Upload, X, ImageIcon } from "lucide-react";
import { CostReport } from "@/components/cost-report";

// ─── Constants ────────────────────────────────────────────────────────────────

const PRODUCT_SEGMENTS = Object.keys(SEGMENT_CATEGORY_PRICE_MAP);

const POLKI_SIZES = ["Far", "Big", "Normal"];

const MOTIF_CATEGORIES = [
  "Animal & Bird", "Celestial & Spiritual", "Contemporary Luxury",
  "Forms & Shapes", "Nature - Inspired", "Multiple Choice", "No Motifs",
];

const MOTIF_GROUPS: Record<string, string[]> = {
  "Animal & Bird": ["Bird", "Horse", "Parrot", "Peacock", "Elephant", "Butterfly", "Tiger/Panther", "Swan", "Lion"],
  "Celestial & Spiritual": ["Sun", "Crescent Moon", "Stars"],
  "Contemporary Luxury": ["Art Deco", "Victorian Art", "Scallop", "Ribbons"],
  "Forms & Shapes": ["Domes & Arches", "Geometric", "Abstract", "Asymmetrical", "Ovals", "Marquise", "Pears", "Curves", "Jaali Patterns"],
  "Nature - Inspired": ["Lotus", "Rose", "Tulip", "Paan", "Paisley", "Leaves", "Cluster Flowers"],
};

const ALL_MOTIFS = Object.values(MOTIF_GROUPS).flat();

const STONE_COLOURS = [
  "Red Stone", "Green Stone", "Blue Stone", "Pink Stone", "White Stone",
  "Coral Stone", "Multicolour Stone", "Navratna Stone", "Violet Stone", "Yellow Stone",
];

const FINISHES = [
  "Yellow Gold Finish", "Light Antique", "Dark Antique", "Matte",
  "Hammered", "Dual Tone", "White Rhodium", "Rose Gold Finish",
];

const DESIGN_SHAPES = [
  "Classic Choker", "Dog Band Choker", "Choker With Jhaalar", "Semi Chokar",
  "T-Shape", "Round", "Oval", "Studs", "Drops", "Hoops", "Earcuff",
  "Basic", "U-Shape", "Y-Shape", "V-Shape", "Layered", "Hasli",
];

const MATERIAL_RATIOS = [
  "Polki Intensive", "Diamond Intensive", "Stone Intensive",
  "Gold Intensive", "Piroi Intensive",
];

const TALAFS = ["None", "Talaf-Red", "Talaf-Green", "Talaf-Blue", "Talaf-Pink"];
const PIROI_PLACEMENTS = ["None", "Top", "Front", "Back", "Latkan"];
const PIROI_COLOURS = ["None", "Red", "Green", "Blue", "White", "Pink"];

// ─── Form types ───────────────────────────────────────────────────────────────

interface FormValues {
  productSegment: string;
  category: string;
  priceBand: string;
  polkiSize: string;
  motifCategory: string;
  motifs: string[];
  stoneColour: string[];
  enamel: string;
  finish: string;
  designShape: string;
  materialRatio: string;
  goldRatePerGram: number;
  goldPurity: string;
  goldPercentage: number;
  talaf: string;
  piroiPlacement: string;
  piroiColour: string;
  customNotes: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ModifyPage() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ModifyDesignResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { register, handleSubmit, watch, setValue, getValues } = useForm<FormValues>({
    defaultValues: {
      motifs: [],
      stoneColour: [],
      enamel: "",
      goldRatePerGram: 7000,
      goldPurity: "18k",
      goldPercentage: 40,
      talaf: "None",
      piroiPlacement: "None",
      piroiColour: "None",
    },
  });

  const watchedMotifs = watch("motifs") || [];
  const watchedStones = watch("stoneColour") || [];
  const watchedSegment = watch("productSegment");
  const watchedCategory = watch("category");
  const watchedGoldPurity = watch("goldPurity") || "18k";
  const watchedGoldPercentage = watch("goldPercentage") ?? 40;

  // Derive cascading options
  const availableCategories = watchedSegment
    ? (SEGMENT_CATEGORY_PRICE_MAP[watchedSegment] || []).map(e => e.category)
    : [];
  const availablePriceBands = watchedSegment && watchedCategory
    ? (SEGMENT_CATEGORY_PRICE_MAP[watchedSegment] || []).find(e => e.category === watchedCategory)?.price_bands || []
    : [];

  // ── File handling ──────────────────────────────────────────────────────────

  function handleFileSelect(file: File) {
    if (!file.type.match(/image\/(jpeg|png)/)) {
      toast({ title: "Invalid file type", description: "Please upload a JPEG or PNG image.", variant: "destructive" });
      return;
    }
    setUploadedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }

  function clearFile() {
    setUploadedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Checkbox helpers ───────────────────────────────────────────────────────

  function toggleMotif(motif: string) {
    const current = getValues("motifs") || [];
    setValue("motifs", current.includes(motif) ? current.filter(m => m !== motif) : [...current, motif]);
  }

  function toggleStone(stone: string) {
    const current = getValues("stoneColour") || [];
    setValue("stoneColour", current.includes(stone) ? current.filter(s => s !== stone) : [...current, stone]);
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  const onSubmit = async (values: FormValues) => {
    if (!uploadedFile) {
      toast({ title: "No image selected", description: "Please upload a jewellery image to modify.", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    try {
      const params: ModifyDesignParams = {
        productSegment: values.productSegment || undefined,
        category: values.category || undefined,
        priceBand: values.priceBand || undefined,
        polkiSize: values.polkiSize || undefined,
        motifCategory: values.motifCategory || undefined,
        motifs: values.motifs?.length ? values.motifs : undefined,
        stoneColour: values.stoneColour?.length ? values.stoneColour : undefined,
        enamel: values.enamel || undefined,
        finish: values.finish || undefined,
        designShape: values.designShape || undefined,
        materialRatio: values.materialRatio || undefined,
        goldRatePerGram: values.goldRatePerGram || undefined,
        goldPurity: values.goldPurity || undefined,
        goldPercentage: values.goldPercentage,
        talaf: values.talaf !== "None" ? values.talaf : undefined,
        piroiPlacement: values.piroiPlacement !== "None" ? values.piroiPlacement : undefined,
        piroiColour: values.piroiColour !== "None" ? values.piroiColour : undefined,
        customNotes: values.customNotes || undefined,
      };

      const data = await modifyDesign(uploadedFile, params);
      setResult(data);
    } catch (error: any) {
      toast({ title: "Modification failed", description: error.message || "Failed to modify design. Please try again.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Layout>
      {/* Hero strip */}
      <div className="text-center py-8 mb-4">
        <p className="font-serif text-xl italic text-muted-foreground tracking-wide">
          Transform Your Designs with Precision
        </p>
        <OrnamentalDivider className="mt-3" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 max-w-7xl mx-auto">

        {/* ── Left Column ── */}
        <div className="lg:col-span-5 space-y-6">
          <div className="space-y-2 mb-6">
            <h2 className="text-3xl font-serif text-foreground">Design Modifier</h2>
            <p className="text-muted-foreground">
              Upload an existing jewellery image and apply new design parameters.
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

            {/* Image Upload Zone */}
            <div className="space-y-2">
              <Label className="font-serif text-sm font-medium">Reference Image *</Label>
              {!uploadedFile ? (
                <div
                  className="border-2 border-dashed border-amber-400/60 rounded-lg p-8 text-center cursor-pointer hover:border-amber-400 hover:bg-amber-50/30 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={handleDrop}
                >
                  <Upload className="w-8 h-8 mx-auto mb-3 text-amber-500/60" />
                  <p className="font-serif text-sm text-muted-foreground">
                    Click to browse or drag &amp; drop
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-1">JPEG, PNG — max 10MB</p>
                </div>
              ) : (
                <div className="border border-border/60 rounded-lg overflow-hidden bg-white/60">
                  <div className="relative aspect-square bg-muted/20">
                    <img
                      src={previewUrl!}
                      alt="Upload preview"
                      className="w-full h-full object-contain p-4"
                    />
                    <button
                      type="button"
                      onClick={clearFile}
                      className="absolute top-2 right-2 bg-white/90 rounded-full p-1 shadow hover:bg-white transition-colors"
                    >
                      <X className="w-4 h-4 text-foreground" />
                    </button>
                  </div>
                  <div className="px-3 py-2 border-t border-border/40 flex items-center gap-2">
                    <ImageIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs text-muted-foreground truncate">{uploadedFile.name}</span>
                    <span className="text-xs text-muted-foreground/60 flex-shrink-0 ml-auto">
                      {(uploadedFile.size / 1024).toFixed(0)} KB
                    </span>
                  </div>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={handleInputChange}
              />
            </div>

            {/* Product Segment */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Product Segment</Label>
              <Select
                value={watchedSegment || ""}
                onValueChange={v => {
                  setValue("productSegment", v);
                  setValue("category", "");
                  setValue("priceBand", "");
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select segment" /></SelectTrigger>
                <SelectContent>
                  {PRODUCT_SEGMENTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Category (cascaded from Segment) */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Category</Label>
              <Select
                value={watchedCategory || ""}
                onValueChange={v => {
                  setValue("category", v);
                  setValue("priceBand", "");
                }}
                disabled={!watchedSegment}
              >
                <SelectTrigger><SelectValue placeholder={watchedSegment ? "Select category" : "Select a segment first"} /></SelectTrigger>
                <SelectContent>
                  {availableCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Price Band (cascaded from Segment + Category) */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Price Band</Label>
              <Select
                value={watch("priceBand") || ""}
                onValueChange={v => setValue("priceBand", v)}
                disabled={!watchedCategory || availablePriceBands.length === 0}
              >
                <SelectTrigger><SelectValue placeholder={watchedCategory ? "Select price band" : "Select a category first"} /></SelectTrigger>
                <SelectContent>
                  {availablePriceBands.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Polki Size */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Polki Size</Label>
              <Select onValueChange={v => setValue("polkiSize", v)}>
                <SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger>
                <SelectContent>
                  {POLKI_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Motif Category */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Motif Category</Label>
              <Select onValueChange={v => setValue("motifCategory", v)}>
                <SelectTrigger><SelectValue placeholder="Select motif category" /></SelectTrigger>
                <SelectContent>
                  {MOTIF_CATEGORIES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Motifs */}
            <div className="space-y-2">
              <Label className="font-serif text-sm font-medium">Motifs</Label>
              <div className="space-y-3 border border-border/40 rounded-lg p-3 bg-white/40 max-h-64 overflow-y-auto">
                {Object.entries(MOTIF_GROUPS).map(([group, motifs]) => (
                  <div key={group}>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">{group}</p>
                    <div className="flex flex-wrap gap-2">
                      {motifs.map(motif => (
                        <label key={motif} className="flex items-center gap-1.5 cursor-pointer">
                          <Checkbox
                            checked={watchedMotifs.includes(motif)}
                            onCheckedChange={() => toggleMotif(motif)}
                          />
                          <span className="text-xs">{motif}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {watchedMotifs.length > 0 && (
                <p className="text-xs text-muted-foreground">{watchedMotifs.length} motif(s) selected</p>
              )}
            </div>

            {/* Stone Colour */}
            <div className="space-y-2">
              <Label className="font-serif text-sm font-medium">Stone Colour</Label>
              <div className="flex flex-wrap gap-2 border border-border/40 rounded-lg p-3 bg-white/40">
                {STONE_COLOURS.map(stone => (
                  <label key={stone} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={watchedStones.includes(stone)}
                      onCheckedChange={() => toggleStone(stone)}
                    />
                    <span className="text-xs">{stone}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Enamel */}
            <div className="space-y-2">
              <Label className="font-serif text-sm font-medium">Enamel</Label>
              <RadioGroup onValueChange={v => setValue("enamel", v)} className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="Yes" />
                  <span className="text-sm">Yes</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="No" />
                  <span className="text-sm">No</span>
                </label>
              </RadioGroup>
            </div>

            {/* Finish */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Finish</Label>
              <Select onValueChange={v => setValue("finish", v)}>
                <SelectTrigger><SelectValue placeholder="Select finish" /></SelectTrigger>
                <SelectContent>
                  {FINISHES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Design Shape */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Design Shape</Label>
              <Select onValueChange={v => setValue("designShape", v)}>
                <SelectTrigger><SelectValue placeholder="Select shape" /></SelectTrigger>
                <SelectContent>
                  {DESIGN_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Material Ratio */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Material Ratio</Label>
              <Select onValueChange={v => setValue("materialRatio", v)}>
                <SelectTrigger><SelectValue placeholder="Select material ratio" /></SelectTrigger>
                <SelectContent>
                  {MATERIAL_RATIOS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Gold Rate */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Gold Rate (₹/gram)</Label>
              <input
                type="number"
                min={1000}
                {...register("goldRatePerGram", { valueAsNumber: true })}
                placeholder="e.g. 7000"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">Enter today's 24k gold rate per gram</p>
            </div>

            {/* Gold Purity */}
            <div className="space-y-2">
              <Label className="font-serif text-sm font-medium">Gold Purity</Label>
              <div className="flex gap-2">
                {(["14k", "18k", "22k"] as const).map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setValue("goldPurity", k)}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      watchedGoldPurity === k
                        ? "bg-amber-600 text-white"
                        : "border border-amber-400 text-amber-700 hover:bg-amber-50"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            {/* Gold vs Stone Allocation */}
            <div className="space-y-2">
              <Label className="font-serif text-sm font-medium">Gold vs Stone Allocation</Label>
              <input
                type="range"
                min={5}
                max={95}
                step={1}
                value={watchedGoldPercentage}
                onChange={e => setValue("goldPercentage", Number(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-amber-600 bg-gradient-to-r from-amber-200 to-emerald-200"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span className="font-medium text-amber-700">Gold — {watchedGoldPercentage}%</span>
                <span className="font-medium text-emerald-700">Stones — {100 - watchedGoldPercentage}%</span>
              </div>
            </div>

            {/* Talaf */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Talaf</Label>
              <Select defaultValue="None" onValueChange={v => setValue("talaf", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TALAFS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Piroi Placement */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Piroi Placement</Label>
              <Select defaultValue="None" onValueChange={v => setValue("piroiPlacement", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PIROI_PLACEMENTS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Piroi Colour */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Piroi Colour</Label>
              <Select defaultValue="None" onValueChange={v => setValue("piroiColour", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PIROI_COLOURS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Custom Notes */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Custom Notes</Label>
              <Textarea
                {...register("customNotes")}
                placeholder="Add any extra instructions, specific details, or modifications you want..."
                className="min-h-[80px] resize-none"
              />
            </div>

            {/* Submit */}
            <Button
              type="submit"
              className="w-full font-serif tracking-wide"
              disabled={!uploadedFile || isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Modifying Design...
                </>
              ) : (
                "Modify Design"
              )}
            </Button>
          </form>
        </div>

        {/* ── Right Column ── */}
        <div className="lg:col-span-7">
          <div className="space-y-2 mb-6 lg:text-right">
            <h2 className="text-3xl font-serif text-foreground">Modified Output</h2>
            <p className="text-muted-foreground">
              Your reimagined design will appear here.
            </p>
          </div>

          {result ? (
            <ResultDisplay
              result={result}
              category={getValues("category") || "Modification"}
            />
          ) : (
            <div className="flex flex-col items-center justify-center min-h-[400px] border-2 border-dashed border-border/60 rounded-xl bg-white/40 p-8 text-center">
              <OrnamentalDivider className="mb-4" />
              <p className="font-serif italic text-muted-foreground text-lg">
                Upload a design and set parameters to begin modification
              </p>
              <p className="text-sm text-muted-foreground/60 mt-2">
                Your modified sketch will appear here
              </p>
            </div>
          )}
        </div>

      </div>

      {/* ── AI Cost Report Section ── */}
      {result?.costReport && (
        <>
          <OrnamentalDivider className="my-8" />
          <div className="max-w-7xl mx-auto">
            <div className="space-y-2 mb-6">
              <h2 className="text-3xl font-serif text-foreground">Material Cost Breakdown</h2>
              <p className="text-muted-foreground">
                AI-estimated material costs based on the generated design.
              </p>
            </div>
            <CostReport report={result.costReport} />
          </div>
        </>
      )}
    </Layout>
  );
}
