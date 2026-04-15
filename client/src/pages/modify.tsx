import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Layout } from "@/components/layout";
import { OrnamentalDivider } from "@/components/ornamental-divider";
import { MultiModelResult } from "@/components/multi-model-result";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { modifyDesign, type ModifyDesignParams, type ModifyDesignResponse, SEGMENT_CATEGORY_PRICE_MAP, DESIGN_SHAPE_MAP, STONE_NAME_COLOUR_MAP, ALL_STONE_NAMES, STONE_SHAPE_GROUPS, stoneShapeSelectValue, parseStoneShapeValue } from "@/lib/api";
import { STYLE_INSPIRATIONS } from "@/lib/jewellery-logic";
import { Loader2, Upload, X, ImageIcon } from "lucide-react";
import { CostReport } from "@/components/cost-report";
import { FeedbackForm } from "@/components/feedback-form";

// ─── Constants ────────────────────────────────────────────────────────────────

const PRODUCT_SEGMENTS = Object.keys(SEGMENT_CATEGORY_PRICE_MAP);

const POLKI_SIZES = ["Any", "Far", "Big", "Medium", "Small"];

const TECHNIQUES = ["Talpe", "Piroyee (Piroi)", "Enamel", "Twisted Wire", "Metal Texture"];

const POLKI_SETTINGS = [
  "Bezel / Ghaati", "Patti", "Prong", "Jadai", "Paal / Katori", "Matha Setting",
  "3 Prong Setting", "Preminu/Tiger Claw", "Gadd Setting", "Data Prong", "Kundan Cut",
];

const MOTIF_CATEGORIES = [
  "Any",
  "Animal & Bird",
  "Celestial & Spiritual",
  "Nature-Inspired",
  "Contemporary Luxury",
  "Forms & Shapes",
  "Multiple Choice",
  "No Motifs",
];

const MOTIF_GROUPS: Record<string, string[]> = {
  "Animal & Bird": [
    "Swan", "Parrot", "Peacock", "Elephant", "Butterfly", "Tiger", "Lion",
    "Bird", "Lady Bug", "Dragonfly", "Honey Bee", "Phoenix Bird", "Panda",
    "Bear", "Dolphin", "Turtle", "Horse",
  ],
  "Celestial & Spiritual": [
    "Sun", "Crescent Moon", "Stars", "Om Symbol", "Tree of Life",
    "Angel Wings", "Zodiacs", "Healing Chakras", "Hamsa Palm", "Evil Eye",
  ],
  "Nature-Inspired": [
    "Lotus", "Rose", "Tulip", "Paan", "Paisley", "Leaves", "Cluster Flowers", "Clover Leaf",
  ],
  "Contemporary Luxury": [
    "Art Deco", "Victorian Art", "Filigree",
  ],
  "Forms & Shapes": [
    "Geometric", "Abstract", "Asymmetrical", "Scallop", "Ribbons",
    "Domes & Arches", "Curves", "Ovals", "Marquise", "Diamond Shape",
    "Pears", "Heart", "Spade", "Club",
  ],
  "Multiple Choice": [
    "Jaali Patterns",
  ],
  // "No Motifs" intentionally has no entry — produces empty motif list
};

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

const DESIGN_TYPES = ["Graduation/Gradation", "Dome", "Lines (LNS)", "Dant"];

const TALAFS = ["None", "Talaf-Red", "Talaf-Green", "Talaf-Blue", "Talaf-Pink"];
const PIROI_PLACEMENTS = ["None", "Top", "Front", "Back", "Latkan"];
const PIROI_COLOURS = ["None", "Red", "Green", "Blue", "White", "Pink"];

const STONE_SETTINGS: Record<string, string[]> = {
  Traditional: ["Bezel", "Pave", "Rava Prong", "Data Prong", "Partash (Texture Bezel)"],
  Modern: ["Prong", "U Prong", "V Prong", "Claw", "Diamond Prong", "Triple Claw Prong", "Half Bezel", "Gemstone Prong"],
};

const DIAMOND_SETTINGS: Record<string, string[]> = {
  Traditional: ["Bezel", "Chungi / Chakri"],
  Modern: ["Pave", "Micro Pave", "Prong", "Claw (for big size diamond)"],
};


// ─── Form types ───────────────────────────────────────────────────────────────

interface FormValues {
  productSegment: string;
  category: string;
  priceBand: string;
  polkiSize: string[];
  polkiSetting: string;
  motifCategory: string[];
  motifs: string[];
  enamel: string;
  finish: string;
  designShape: string;
  styleInspiration: string;
  designType: string;
  techniques: string[];
  earringStyle: string;
  materialRatio: string;
  goldRatePerGram: number;
  goldPurity: string;
  goldPercentage: number;
  talaf: string;
  piroiPlacement: string;
  piroiColour: string;
  stoneName: string[];
  stoneNameColour: string[];
  stoneShape: string;
  stoneSetting: string;
  diamondSetting: string;
  customNotes: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ModifyPage() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ModifyDesignResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const costReportRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const { register, handleSubmit, watch, setValue, getValues } = useForm<FormValues>({
    defaultValues: {
      polkiSize: [],
      polkiSetting: "",
      motifCategory: [],
      motifs: [],
      stoneName: [],
      stoneNameColour: [],
      stoneShape: "",
      stoneSetting: "",
      diamondSetting: "",
      enamel: "",
      styleInspiration: "",
      designType: "",
      techniques: [],
      goldRatePerGram: 7000,
      goldPurity: "18k",
      goldPercentage: 40,
      talaf: "None",
      piroiPlacement: "None",
      piroiColour: "None",
    },
  });

  const watchedPolkiSizes = watch("polkiSize") || [];
  const watchedTechniques = watch("techniques") || [];
  const watchedMotifCategories = watch("motifCategory") || [];
  const watchedMotifs = watch("motifs") || [];
  const watchedStoneNames = watch("stoneName") || [];
  const watchedStoneNameColours = watch("stoneNameColour") || [];
  const watchedSegment = watch("productSegment");
  const watchedCategory = watch("category");
  const watchedGoldPurity = watch("goldPurity") || "18k";
  const watchedGoldPercentage = watch("goldPercentage") ?? 40;

  // Colours available for the stone-name colour picker — union of selected stones' colours
  const availableStoneNameColours = watchedStoneNames.length > 0
    ? Array.from(new Set(watchedStoneNames.flatMap(n => STONE_NAME_COLOUR_MAP[n] ?? [])))
    : Array.from(new Set(Object.values(STONE_NAME_COLOUR_MAP).flat()));

  // Derive cascading options
  const availableCategories = watchedSegment
    ? (SEGMENT_CATEGORY_PRICE_MAP[watchedSegment] || []).map(e => e.category)
    : [];
  const availablePriceBands = watchedSegment && watchedCategory
    ? (SEGMENT_CATEGORY_PRICE_MAP[watchedSegment] || []).find(e => e.category === watchedCategory)?.price_bands || []
    : [];

  // Derive design shape + earring style from category
  const shapeEntry = watchedCategory ? DESIGN_SHAPE_MAP[watchedCategory] : null;
  const availableDesignShapes = shapeEntry?.shapes ?? DESIGN_SHAPES;
  const availableEarringStyles = shapeEntry?.earringStyles ?? [];

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

  function togglePolkiSize(size: string) {
    const current = getValues("polkiSize") || [];
    if (current.includes(size)) {
      setValue("polkiSize", current.filter(s => s !== size));
    } else if (size === "Any") {
      setValue("polkiSize", ["Any"]);
    } else {
      setValue("polkiSize", [...current.filter(s => s !== "Any"), size]);
    }
  }

  function toggleTechnique(t: string) {
    const current = getValues("techniques") || [];
    setValue("techniques", current.includes(t) ? current.filter(x => x !== t) : [...current, t]);
  }

  function toggleMotifCategory(cat: string) {
    const current = getValues("motifCategory") || [];
    if (current.includes(cat)) {
      setValue("motifCategory", current.filter(c => c !== cat));
    } else if (cat === "Any") {
      setValue("motifCategory", ["Any"]);
    } else if (cat === "No Motifs") {
      setValue("motifCategory", ["No Motifs"]);
    } else {
      setValue("motifCategory", [...current.filter(c => c !== "Any" && c !== "No Motifs"), cat]);
    }
  }

  useEffect(() => {
    if (watchedMotifCategories.includes("Any")) return; // "Any" category shows all groups — don't clear
    const available = new Set(
      watchedMotifCategories.flatMap(cat => MOTIF_GROUPS[cat] ?? [])
    );
    const currentMotifs = getValues("motifs") || [];
    setValue("motifs", currentMotifs.filter(m => m === "Any" || available.has(m)));
  }, [watchedMotifCategories]);

  // Compute motif groups to display based on selected categories
  const availableMotifGroups = watchedMotifCategories.length === 0
    ? []
    : watchedMotifCategories.includes("Any")
      ? Object.entries(MOTIF_GROUPS).map(([group, motifs]) => ({ group, motifs }))
      : watchedMotifCategories
          .filter(cat => cat !== "No Motifs" && MOTIF_GROUPS[cat])
          .map(cat => ({ group: cat, motifs: MOTIF_GROUPS[cat] }));

  function toggleMotif(motif: string) {
    const current = getValues("motifs") || [];
    if (current.includes(motif)) {
      setValue("motifs", current.filter(m => m !== motif));
    } else if (motif === "Any") {
      setValue("motifs", ["Any"]);
    } else {
      setValue("motifs", [...current.filter(m => m !== "Any"), motif]);
    }
  }

  function toggleStoneName(name: string) {
    const current = getValues("stoneName") || [];
    const next = current.includes(name) ? current.filter(n => n !== name) : [...current, name];
    setValue("stoneName", next);
    // Drop colour selections that are no longer valid for the new stone set
    const validColours = new Set(next.flatMap(n => STONE_NAME_COLOUR_MAP[n] ?? []));
    const currentColours = getValues("stoneNameColour") || [];
    setValue("stoneNameColour", currentColours.filter(c => validColours.has(c)));
  }

  function toggleStoneNameColour(colour: string) {
    const current = getValues("stoneNameColour") || [];
    setValue("stoneNameColour", current.includes(colour) ? current.filter(c => c !== colour) : [...current, colour]);
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
        polkiSize: values.polkiSize?.length ? values.polkiSize : undefined,
        polkiSetting: values.polkiSetting || undefined,
        motifCategory: values.motifCategory?.length ? values.motifCategory.join(", ") : undefined,
        motifs: values.motifs?.length ? values.motifs : undefined,
        enamel: values.enamel || undefined,
        finish: values.finish || undefined,
        designShape: values.designShape || undefined,
        styleInspiration: values.styleInspiration || undefined,
        designType: values.designType || undefined,
        techniques: values.techniques?.length ? values.techniques : undefined,
        earringStyle: values.earringStyle || undefined,
        materialRatio: values.materialRatio || undefined,
        goldRatePerGram: values.goldRatePerGram || undefined,
        goldPurity: values.goldPurity || undefined,
        goldPercentage: values.goldPercentage,
        talaf: values.talaf !== "None" ? values.talaf : undefined,
        piroiPlacement: values.piroiPlacement !== "None" ? values.piroiPlacement : undefined,
        piroiColour: values.piroiColour !== "None" ? values.piroiColour : undefined,
        stoneName: values.stoneName?.length ? values.stoneName : undefined,
        stoneNameColour: values.stoneNameColour?.length ? values.stoneNameColour : undefined,
        stoneShape: values.stoneShape ? parseStoneShapeValue(values.stoneShape) : undefined,
        stoneSetting: values.stoneSetting || undefined,
        diamondSetting: values.diamondSetting || undefined,
        customNotes: values.customNotes || undefined,
      };

      const data = await modifyDesign(uploadedFile, params);
      setResult(data);
      if (data.costReport) {
        setTimeout(() => costReportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
      }
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
                  setValue("designShape", "");
                  setValue("earringStyle", "");
                }}
                disabled={!watchedSegment}
              >
                <SelectTrigger><SelectValue placeholder={watchedSegment ? "Select category" : "Select a segment first"} /></SelectTrigger>
                <SelectContent>
                  {availableCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Earring Style (only for Set categories) */}
            {availableEarringStyles.length > 0 && (
              <div className="space-y-1.5">
                <Label className="font-serif text-sm font-medium">Earring Style</Label>
                <Select
                  value={watch("earringStyle") || ""}
                  onValueChange={v => setValue("earringStyle", v)}
                >
                  <SelectTrigger><SelectValue placeholder="Select earring style" /></SelectTrigger>
                  <SelectContent>
                    {availableEarringStyles.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

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
            <div className="space-y-2">
              <Label className="font-serif text-sm font-medium">Polki Size</Label>
              <div className="flex flex-wrap gap-3 border border-border/40 rounded-lg p-3 bg-white/40">
                {POLKI_SIZES.map(size => (
                  <label key={size} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={watchedPolkiSizes.includes(size)}
                      onCheckedChange={() => togglePolkiSize(size)}
                    />
                    <span className="text-xs">{size}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Polki Setting */}
            <div className="space-y-2">
              <Label className="font-serif text-sm font-medium">Polki Setting</Label>
              <Select value={watch("polkiSetting") || ""} onValueChange={(v) => setValue("polkiSetting", v)}>
                <SelectTrigger className="bg-white/40 border-border/40">
                  <SelectValue placeholder="Select setting style" />
                </SelectTrigger>
                <SelectContent>
                  {POLKI_SETTINGS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Motif Category */}
            <div className="space-y-2">
              <Label className="font-serif text-sm font-medium">Motif Category</Label>
              <div className="flex flex-wrap gap-2 border border-border/40 rounded-lg p-3 bg-white/40">
                {MOTIF_CATEGORIES.map(cat => (
                  <label key={cat} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={watchedMotifCategories.includes(cat)}
                      onCheckedChange={() => toggleMotifCategory(cat)}
                    />
                    <span className="text-xs">{cat}</span>
                  </label>
                ))}
              </div>
              {watchedMotifCategories.length > 0 && (
                <p className="text-xs text-muted-foreground">{watchedMotifCategories.length} category(s) selected</p>
              )}
            </div>

            {/* Motifs */}
            <div className="space-y-2">
              <Label className="font-serif text-sm font-medium">Motifs</Label>
              <div className="space-y-3 border border-border/40 rounded-lg p-3 bg-white/40 max-h-64 overflow-y-auto">
                {availableMotifGroups.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60">
                    {watchedMotifCategories.includes("No Motifs")
                      ? "No Motifs selected — no motif will be applied"
                      : "Select motif categories above to see available motifs"}
                  </p>
                ) : (
                  <>
                  <div className="pb-2 mb-2 border-b border-border/30">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <Checkbox
                        checked={watchedMotifs.includes("Any")}
                        onCheckedChange={() => toggleMotif("Any")}
                      />
                      <span className="text-xs font-medium">Any — AI's Choice</span>
                    </label>
                  </div>
                  {availableMotifGroups.map(({ group, motifs }) => (
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
                  </>
                )}
              </div>
              {watchedMotifs.length > 0 && (
                <p className="text-xs text-muted-foreground">{watchedMotifs.length} motif(s) selected</p>
              )}
            </div>

            {/* Stone Name */}
            <div className="space-y-2">
              <Label className="font-serif text-sm font-medium">Stone Name</Label>
              <div className="flex flex-wrap gap-2 border border-border/40 rounded-lg p-3 bg-white/40 max-h-48 overflow-y-auto">
                {ALL_STONE_NAMES.map(name => (
                  <label key={name} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={watchedStoneNames.includes(name)}
                      onCheckedChange={() => toggleStoneName(name)}
                    />
                    <span className="text-xs">{name}</span>
                  </label>
                ))}
              </div>
              {watchedStoneNames.length > 0 && (
                <p className="text-xs text-muted-foreground">{watchedStoneNames.length} stone(s) selected</p>
              )}
            </div>

            {/* Stone Name Colour */}
            <div className="space-y-2">
              <Label className="font-serif text-sm font-medium">Stone Color</Label>
              <div className="flex flex-wrap gap-2 border border-border/40 rounded-lg p-3 bg-white/40 min-h-[48px]">
                {availableStoneNameColours.map(colour => (
                  <label
                    key={colour}
                    className={`flex items-center gap-1.5 ${
                      watchedStoneNames.length === 0 ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
                    }`}
                  >
                    <Checkbox
                      checked={watchedStoneNameColours.includes(colour)}
                      onCheckedChange={() => toggleStoneNameColour(colour)}
                      disabled={watchedStoneNames.length === 0}
                    />
                    <span className="text-xs">{colour}</span>
                  </label>
                ))}
              </div>
              {watchedStoneNames.length === 0 && (
                <p className="text-xs text-muted-foreground/60">Select stone names above to filter colours</p>
              )}
            </div>

            {/* Stone Shape */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Stone Shape</Label>
              <Select onValueChange={v => setValue("stoneShape", v)}>
                <SelectTrigger><SelectValue placeholder="Select stone shape" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STONE_SHAPE_GROUPS).map(([group, shapes]) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{group}</SelectLabel>
                      {shapes.map(s => <SelectItem key={`${group}-${s}`} value={stoneShapeSelectValue(group, s)}>{s}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Stone Setting */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Stone Setting</Label>
              <Select value={watch("stoneSetting") || ""} onValueChange={v => setValue("stoneSetting", v)}>
                <SelectTrigger className="bg-white/40 border-border/40"><SelectValue placeholder="Select setting style" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STONE_SETTINGS).map(([group, options]) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{group}</SelectLabel>
                      {options.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Diamond Setting */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Diamond Setting</Label>
              <Select value={watch("diamondSetting") || ""} onValueChange={v => setValue("diamondSetting", v)}>
                <SelectTrigger className="bg-white/40 border-border/40"><SelectValue placeholder="Select diamond setting" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DIAMOND_SETTINGS).map(([group, options]) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{group}</SelectLabel>
                      {options.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
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

            {/* Style Inspiration */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Style Inspiration</Label>
              <Select value={watch("styleInspiration") || ""} onValueChange={v => setValue("styleInspiration", v)}>
                <SelectTrigger><SelectValue placeholder="Select style inspiration" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STYLE_INSPIRATIONS).map(([group, styles]) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{group}</SelectLabel>
                      {styles.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Design Shape */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Design Shape</Label>
              <Select
                value={watch("designShape") || ""}
                onValueChange={v => setValue("designShape", v)}
                disabled={!watchedCategory}
              >
                <SelectTrigger><SelectValue placeholder={watchedCategory ? "Select shape" : "Select a category first"} /></SelectTrigger>
                <SelectContent className="max-h-[200px]">
                  {availableDesignShapes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Design Type */}
            <div className="space-y-1.5">
              <Label className="font-serif text-sm font-medium">Design Type</Label>
              <Select value={watch("designType") || ""} onValueChange={v => setValue("designType", v)}>
                <SelectTrigger className="bg-white/40 border-border/40"><SelectValue placeholder="Select design type" /></SelectTrigger>
                <SelectContent>
                  {DESIGN_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* Techniques */}
            <div className="space-y-2">
              <Label className="font-serif text-sm font-medium">Techniques</Label>
              <div className="flex flex-wrap gap-3 border border-border/40 rounded-lg p-3 bg-white/40">
                {TECHNIQUES.map(t => (
                  <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={watchedTechniques.includes(t)}
                      onCheckedChange={() => toggleTechnique(t)}
                    />
                    <span className="text-xs">{t}</span>
                  </label>
                ))}
              </div>
              {watchedTechniques.length > 0 && (
                <p className="text-xs text-muted-foreground">{watchedTechniques.length} technique(s) selected</p>
              )}
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
                {(["9k", "14k", "18k", "22k"] as const).map(k => (
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
            <div className="space-y-6">
              {(result.gemini || result.openai || result.grok) && (
                <MultiModelResult
                  gemini={result.gemini}
                  openai={result.openai}
                  grok={result.grok}
                />
              )}
              <FeedbackForm
                designProjectId={result.id}
                category={watchedCategory || "Necklace"}
                theme={watchedSegment || "Modern"}
              />
            </div>
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
          <div ref={costReportRef} className="max-w-7xl mx-auto">
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
