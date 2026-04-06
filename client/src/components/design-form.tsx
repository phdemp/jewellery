import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Loader2, Wand2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DesignRequest } from "@/lib/jewellery-logic";
import {
  SEGMENT_CATEGORY_PRICE_MAP,
  DESIGN_SHAPE_MAP,
  STONE_NAME_COLOUR_MAP,
  ALL_STONE_NAMES,
  STONE_SHAPES,
} from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

// ─── Constants ────────────────────────────────────────────────────────────────

const PRODUCT_SEGMENTS = Object.keys(SEGMENT_CATEGORY_PRICE_MAP);

const POLKI_SIZES = ["Any", "Far", "Big", "Medium", "Small"];

const TECHNIQUES = ["Talpe", "Piroyee (Piroi)", "Enamel", "Twisted Wire", "Metal Texture"];

const POLKI_SETTINGS = [
  "Bezel / Ghaati", "Patti", "Prong", "Jadai", "Paal / Katori", "Matha Setting",
  "3 Prong Setting", "Preminu/Tiger Claw", "Gadd Setting", "Data Prong", "Kundan Cut",
];

const MOTIF_CATEGORIES = [
  "Any", "Animal & Bird", "Celestial & Spiritual", "Nature-Inspired",
  "Contemporary Luxury", "Forms & Shapes", "Multiple Choice", "No Motifs",
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
  "Contemporary Luxury": ["Art Deco", "Victorian Art", "Filigree"],
  "Forms & Shapes": [
    "Geometric", "Abstract", "Asymmetrical", "Scallop", "Ribbons",
    "Domes & Arches", "Curves", "Ovals", "Marquise", "Diamond Shape",
    "Pears", "Heart", "Spade", "Club",
  ],
  "Multiple Choice": ["Jaali Patterns"],
  // "No Motifs" intentionally has no entry
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
  stoneName: string[];
  stoneNameColour: string[];
  stoneShape: string;
  stoneSetting: string;
  diamondSetting: string;
  enamel: string;
  finish: string;
  designShape: string;
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
  customNotes: string;
}

interface StyleOverrideImage {
  file: File;
  previewUrl: string;
}

interface DesignFormProps {
  onSubmit: (data: DesignRequest, styleOverride?: File) => void;
  isGenerating: boolean;
}

export function DesignForm({ onSubmit, isGenerating }: DesignFormProps) {
  const [styleOverride, setStyleOverride] = useState<StyleOverrideImage | null>(null);
  const { toast } = useToast();

  const { watch, setValue, getValues, handleSubmit } = useForm<FormValues>({
    defaultValues: {
      productSegment: "",
      category: "",
      priceBand: "",
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
      finish: "",
      designShape: "",
      designType: "",
      techniques: [],
      earringStyle: "",
      materialRatio: "",
      goldRatePerGram: 7000,
      goldPurity: "18k",
      goldPercentage: 40,
      talaf: "None",
      piroiPlacement: "None",
      piroiColour: "None",
      customNotes: "",
    },
  });

  const watchedSegment       = watch("productSegment");
  const watchedCategory      = watch("category");
  const watchedMotifCats     = watch("motifCategory") || [];
  const watchedMotifs        = watch("motifs") || [];
  const watchedStoneNames    = watch("stoneName") || [];
  const watchedStoneColours  = watch("stoneNameColour") || [];
  const watchedPolkiSizes    = watch("polkiSize") || [];
  const watchedTechniques    = watch("techniques") || [];
  const watchedGoldPurity    = watch("goldPurity") || "18k";
  const watchedGoldPct       = watch("goldPercentage") ?? 40;

  // Cascading dropdown options
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

  // Colours available for stone colour picker — union of selected stones' colours
  const availableStoneNameColours = watchedStoneNames.length > 0
    ? Array.from(new Set(watchedStoneNames.flatMap(n => STONE_NAME_COLOUR_MAP[n] ?? [])))
    : Array.from(new Set(Object.values(STONE_NAME_COLOUR_MAP).flat()));

  // Compute motif groups to display based on selected categories
  const availableMotifGroups = watchedMotifCats.length === 0
    ? []
    : watchedMotifCats.includes("Any")
      ? Object.entries(MOTIF_GROUPS).map(([group, motifs]) => ({ group, motifs }))
      : watchedMotifCats
          .filter(cat => cat !== "No Motifs" && MOTIF_GROUPS[cat])
          .map(cat => ({ group: cat, motifs: MOTIF_GROUPS[cat] }));

  // When motif categories change, clear motifs that are no longer available
  useEffect(() => {
    if (watchedMotifCats.includes("Any")) return; // "Any" category shows all groups — don't clear
    const available = new Set(
      watchedMotifCats.flatMap(cat => MOTIF_GROUPS[cat] ?? [])
    );
    const currentMotifs = getValues("motifs") || [];
    setValue("motifs", currentMotifs.filter(m => m === "Any" || available.has(m)));
  }, [watchedMotifCats]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle helpers ──────────────────────────────────────────────────────────

  function togglePolkiSize(size: string) {
    const curr = getValues("polkiSize") || [];
    if (curr.includes(size)) {
      setValue("polkiSize", curr.filter(s => s !== size));
    } else if (size === "Any") {
      setValue("polkiSize", ["Any"]);
    } else {
      setValue("polkiSize", [...curr.filter(s => s !== "Any"), size]);
    }
  }

  function toggleTechnique(t: string) {
    const curr = getValues("techniques") || [];
    setValue("techniques", curr.includes(t) ? curr.filter(x => x !== t) : [...curr, t]);
  }

  function toggleMotifCategory(cat: string) {
    const curr = getValues("motifCategory") || [];
    if (curr.includes(cat)) {
      setValue("motifCategory", curr.filter(c => c !== cat));
    } else if (cat === "Any") {
      setValue("motifCategory", ["Any"]);
    } else if (cat === "No Motifs") {
      setValue("motifCategory", ["No Motifs"]);
    } else {
      setValue("motifCategory", [...curr.filter(c => c !== "Any" && c !== "No Motifs"), cat]);
    }
  }

  function toggleMotif(motif: string) {
    const curr = getValues("motifs") || [];
    if (curr.includes(motif)) {
      setValue("motifs", curr.filter(m => m !== motif));
    } else if (motif === "Any") {
      setValue("motifs", ["Any"]);
    } else {
      setValue("motifs", [...curr.filter(m => m !== "Any"), motif]);
    }
  }

  function toggleStoneName(name: string) {
    const curr = getValues("stoneName") || [];
    const next = curr.includes(name) ? curr.filter(n => n !== name) : [...curr, name];
    setValue("stoneName", next);
    // Drop colour selections that are no longer valid for the new stone set
    const validColours = new Set(next.flatMap(n => STONE_NAME_COLOUR_MAP[n] ?? []));
    const currColours = getValues("stoneNameColour") || [];
    setValue("stoneNameColour", currColours.filter(c => validColours.has(c)));
  }

  function toggleStoneColour(colour: string) {
    const curr = getValues("stoneNameColour") || [];
    setValue("stoneNameColour", curr.includes(colour) ? curr.filter(c => c !== colour) : [...curr, colour]);
  }

  // ── Style override handlers ─────────────────────────────────────────────────

  const handleStyleOverrideUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast({ title: "Invalid file", description: "Please upload an image file (JPEG or PNG).", variant: "destructive" });
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setStyleOverride({ file, previewUrl });
    event.target.value = '';
  };

  const removeStyleOverride = () => {
    if (styleOverride) {
      URL.revokeObjectURL(styleOverride.previewUrl);
      setStyleOverride(null);
    }
  };

  // ── Submit ──────────────────────────────────────────────────────────────────

  function onFormSubmit(values: FormValues) {
    if (!values.productSegment || !values.category) {
      toast({ title: "Missing fields", description: "Please select Product Segment and Category.", variant: "destructive" });
      return;
    }

    const data: DesignRequest = {
      productSegment: values.productSegment || undefined,
      category: values.category,
      priceBand: values.priceBand || undefined,
      polkiSize: values.polkiSize?.length > 0 ? values.polkiSize : undefined,
      polkiSetting: values.polkiSetting || undefined,
      motifCategory: values.motifCategory?.length > 0 ? values.motifCategory : undefined,
      motifs: values.motifs || [],
      stoneName: values.stoneName?.length > 0 ? values.stoneName : undefined,
      stoneNameColour: values.stoneNameColour?.length > 0 ? values.stoneNameColour : undefined,
      stoneShape: values.stoneShape || undefined,
      stoneSetting: values.stoneSetting || undefined,
      diamondSetting: values.diamondSetting || undefined,
      enamel: values.enamel || undefined,
      finish: values.finish || undefined,
      designShape: values.designShape || undefined,
      designType: values.designType || undefined,
      techniques: values.techniques?.length > 0 ? values.techniques : undefined,
      earringStyle: values.earringStyle || undefined,
      materialRatio: values.materialRatio || undefined,
      goldRatePerGram: values.goldRatePerGram || undefined,
      goldPurity: values.goldPurity || undefined,
      goldPercentage: values.goldPercentage,
      talaf: values.talaf !== "None" ? values.talaf : undefined,
      piroiPlacement: values.piroiPlacement !== "None" ? values.piroiPlacement : undefined,
      piroiColour: values.piroiColour !== "None" ? values.piroiColour : undefined,
      customNotes: values.customNotes || undefined,
    };

    onSubmit(data, styleOverride?.file);
  }

  const selectTriggerClass = "bg-white/80 border-border/60 h-10";

  return (
    <Card className="border-border/60 shadow-sm bg-white/60 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="font-serif text-2xl text-foreground">Design Parameters</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onFormSubmit)} className="space-y-5">

          {/* 1. Product Segment */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Product Segment</Label>
            <Select value={watchedSegment} onValueChange={(v) => { setValue("productSegment", v); setValue("category", ""); setValue("priceBand", ""); }}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select segment" /></SelectTrigger>
              <SelectContent className="max-h-[200px]">
                {PRODUCT_SEGMENTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 2. Category (cascaded) */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Category</Label>
            <Select value={watchedCategory} onValueChange={(v) => { setValue("category", v); setValue("priceBand", ""); setValue("designShape", ""); setValue("earringStyle", ""); }} disabled={!watchedSegment}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder={watchedSegment ? "Select category" : "Select segment first"} /></SelectTrigger>
              <SelectContent className="max-h-[200px]">
                {availableCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Earring Style (only for Set categories) */}
          {availableEarringStyles.length > 0 && (
            <div className="space-y-2">
              <Label className="font-serif text-base">Earring Style</Label>
              <Select value={watch("earringStyle")} onValueChange={(v) => setValue("earringStyle", v)}>
                <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select earring style" /></SelectTrigger>
                <SelectContent className="max-h-[200px]">
                  {availableEarringStyles.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 3. Price Band (cascaded) */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Price Band</Label>
            <Select value={watch("priceBand")} onValueChange={(v) => setValue("priceBand", v)} disabled={!watchedCategory}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder={watchedCategory ? "Select price band" : "Select category first"} /></SelectTrigger>
              <SelectContent className="max-h-[200px]">
                {availablePriceBands.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 4. Polki Size */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Polki Size</Label>
            <div className="flex flex-wrap gap-1 p-3 border border-border/40 rounded-md bg-white/40">
              {POLKI_SIZES.map(size => (
                <label key={size} className="flex items-center gap-2 rounded-md border border-transparent hover:bg-secondary/20 p-2 transition-colors cursor-pointer">
                  <Checkbox
                    checked={watchedPolkiSizes.includes(size)}
                    onCheckedChange={() => togglePolkiSize(size)}
                    className="border-primary/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                  <span className="text-sm">{size}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 4b. Polki Setting */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Polki Setting</Label>
            <Select value={watch("polkiSetting")} onValueChange={(v) => setValue("polkiSetting", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select setting style" /></SelectTrigger>
              <SelectContent>
                {POLKI_SETTINGS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 5. Motif Category (multiselect) */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Motif Category</Label>
            <div className="flex flex-wrap gap-2 p-3 border border-border/40 rounded-md bg-white/40">
              {MOTIF_CATEGORIES.map(cat => (
                <label key={cat} className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={watchedMotifCats.includes(cat)}
                    onCheckedChange={() => toggleMotifCategory(cat)}
                    className="border-primary/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                  <span className="text-sm">{cat}</span>
                </label>
              ))}
            </div>
            {watchedMotifCats.length > 0 && (
              <p className="text-xs text-muted-foreground">{watchedMotifCats.length} category(s) selected</p>
            )}
          </div>

          {/* 6. Motifs (grouped checkboxes — only shown for selected categories) */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Motifs</Label>
            <div className="space-y-3 max-h-64 overflow-y-auto p-3 border border-border/40 rounded-md bg-white/40">
              {availableMotifGroups.length === 0 ? (
                <p className="text-xs text-muted-foreground/60">
                  {watchedMotifCats.includes("No Motifs")
                    ? "No Motifs selected — no motif will be applied"
                    : "Select motif categories above to see available motifs"}
                </p>
              ) : (
                <>
                <div className="pb-2 mb-2 border-b border-border/30">
                  <label className="flex items-center gap-2 rounded-md border border-transparent hover:bg-secondary/20 p-1.5 transition-colors cursor-pointer">
                    <Checkbox
                      checked={watchedMotifs.includes("Any")}
                      onCheckedChange={() => toggleMotif("Any")}
                      className="border-primary/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                    <span className="text-sm font-medium">Any — AI's Choice</span>
                  </label>
                </div>
                {availableMotifGroups.map(({ group, motifs }) => (
                  <div key={group}>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">{group}</p>
                    <div className="flex flex-wrap gap-2">
                      {motifs.map(motif => (
                        <label key={motif} className="flex items-center gap-2 rounded-md border border-transparent hover:bg-secondary/20 p-1.5 transition-colors cursor-pointer">
                          <Checkbox
                            checked={watchedMotifs.includes(motif)}
                            onCheckedChange={() => toggleMotif(motif)}
                            className="border-primary/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                          />
                          <span className="text-sm">{motif}</span>
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

          {/* 7. Stone Name */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Stone Name</Label>
            <div className="flex flex-wrap gap-2 p-3 border border-border/40 rounded-md bg-white/40 max-h-48 overflow-y-auto">
              {ALL_STONE_NAMES.map(name => (
                <label key={name} className="flex items-center gap-1.5 cursor-pointer">
                  <Checkbox
                    checked={watchedStoneNames.includes(name)}
                    onCheckedChange={() => toggleStoneName(name)}
                    className="border-primary/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                  <span className="text-sm">{name}</span>
                </label>
              ))}
            </div>
            {watchedStoneNames.length > 0 && (
              <p className="text-xs text-muted-foreground">{watchedStoneNames.length} stone(s) selected</p>
            )}
          </div>

          {/* 8. Stone Color (cascaded from Stone Name) */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Stone Color</Label>
            <div className="flex flex-wrap gap-2 p-3 border border-border/40 rounded-md bg-white/40 min-h-[48px]">
              {availableStoneNameColours.map(colour => (
                <label
                  key={colour}
                  className={`flex items-center gap-1.5 ${watchedStoneNames.length === 0 ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                >
                  <Checkbox
                    checked={watchedStoneColours.includes(colour)}
                    onCheckedChange={() => toggleStoneColour(colour)}
                    disabled={watchedStoneNames.length === 0}
                    className="border-primary/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                  <span className="text-sm">{colour}</span>
                </label>
              ))}
            </div>
            {watchedStoneNames.length === 0 && (
              <p className="text-xs text-muted-foreground/60">Select stone names above to filter colours</p>
            )}
          </div>

          {/* 9. Stone Shape */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Stone Shape</Label>
            <Select value={watch("stoneShape")} onValueChange={(v) => setValue("stoneShape", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select stone shape" /></SelectTrigger>
              <SelectContent>
                {STONE_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 9b. Stone Setting */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Stone Setting</Label>
            <Select value={watch("stoneSetting")} onValueChange={(v) => setValue("stoneSetting", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select setting style" /></SelectTrigger>
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

          {/* 9c. Diamond Setting */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Diamond Setting</Label>
            <Select value={watch("diamondSetting")} onValueChange={(v) => setValue("diamondSetting", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select diamond setting" /></SelectTrigger>
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

          {/* 10. Enamel */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Enamel</Label>
            <RadioGroup value={watch("enamel")} onValueChange={(v) => setValue("enamel", v)} className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="Yes" id="enamel-yes" />
                <Label htmlFor="enamel-yes" className="font-normal cursor-pointer">Yes</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="No" id="enamel-no" />
                <Label htmlFor="enamel-no" className="font-normal cursor-pointer">No</Label>
              </div>
            </RadioGroup>
          </div>

          {/* 11. Finish */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Finish</Label>
            <Select value={watch("finish")} onValueChange={(v) => setValue("finish", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select finish" /></SelectTrigger>
              <SelectContent>
                {FINISHES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 12. Design Shape */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Design Shape</Label>
            <Select value={watch("designShape")} onValueChange={(v) => setValue("designShape", v)} disabled={!watchedCategory}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder={watchedCategory ? "Select design shape" : "Select category first"} /></SelectTrigger>
              <SelectContent className="max-h-[200px]">
                {availableDesignShapes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 12b. Design Type */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Design Type</Label>
            <Select value={watch("designType")} onValueChange={(v) => setValue("designType", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select design type" /></SelectTrigger>
              <SelectContent>
                {DESIGN_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 12c. Techniques */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Techniques</Label>
            <div className="flex flex-wrap gap-1 p-3 border border-border/40 rounded-md bg-white/40">
              {TECHNIQUES.map(t => (
                <label key={t} className="flex items-center gap-2 rounded-md border border-transparent hover:bg-secondary/20 p-2 transition-colors cursor-pointer">
                  <Checkbox
                    checked={watchedTechniques.includes(t)}
                    onCheckedChange={() => toggleTechnique(t)}
                    className="border-primary/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                  <span className="text-sm">{t}</span>
                </label>
              ))}
            </div>
            {watchedTechniques.length > 0 && (
              <p className="text-xs text-muted-foreground">{watchedTechniques.length} technique(s) selected</p>
            )}
          </div>

          {/* 13. Material Ratio */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Material Ratio</Label>
            <Select value={watch("materialRatio")} onValueChange={(v) => setValue("materialRatio", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select material ratio" /></SelectTrigger>
              <SelectContent>
                {MATERIAL_RATIOS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 14. Gold Rate */}
          <div className="space-y-1.5">
            <Label className="font-serif text-base">Gold Rate (₹/gram)</Label>
            <input
              type="number"
              min={1000}
              value={watch("goldRatePerGram")}
              onChange={e => setValue("goldRatePerGram", Number(e.target.value))}
              placeholder="e.g. 7000"
              className="w-full rounded-md border border-input bg-white/80 px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">Enter today's 24k gold rate per gram</p>
          </div>

          {/* 15. Gold Purity */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Gold Purity</Label>
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

          {/* 16. Gold vs Stone Allocation */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Gold vs Stone Allocation</Label>
            <input
              type="range"
              min={5}
              max={95}
              step={1}
              value={watchedGoldPct}
              onChange={e => setValue("goldPercentage", Number(e.target.value))}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-amber-600 bg-gradient-to-r from-amber-200 to-emerald-200"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span className="font-medium text-amber-700">Gold — {watchedGoldPct}%</span>
              <span className="font-medium text-emerald-700">Stones — {100 - watchedGoldPct}%</span>
            </div>
          </div>

          {/* 17. Talaf */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Talaf</Label>
            <Select value={watch("talaf")} onValueChange={(v) => setValue("talaf", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select talaf" /></SelectTrigger>
              <SelectContent>
                {TALAFS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 18. Piroi Placement */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Piroi Placement</Label>
            <Select value={watch("piroiPlacement")} onValueChange={(v) => setValue("piroiPlacement", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select piroi placement" /></SelectTrigger>
              <SelectContent>
                {PIROI_PLACEMENTS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 19. Piroi Colour */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Piroi Colour</Label>
            <Select value={watch("piroiColour")} onValueChange={(v) => setValue("piroiColour", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select piroi colour" /></SelectTrigger>
              <SelectContent>
                {PIROI_COLOURS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Custom Notes */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Custom Notes</Label>
            <Textarea
              placeholder="E.g., Make the pendant slightly larger, add emerald drops..."
              className="bg-white/80 border-border/60 min-h-[80px] resize-none"
              value={watch("customNotes")}
              onChange={(e) => setValue("customNotes", e.target.value)}
            />
          </div>

          {/* Style Override */}
          <div className="space-y-3">
            <Label className="font-serif text-base">Style Override (Optional)</Label>
            <p className="text-sm text-muted-foreground -mt-1">
              Upload an image to override the style. Otherwise, AI will use similar designs from your Reference Library.
            </p>
            <div className="border border-dashed border-border/60 rounded-lg p-4 bg-white/40">
              {styleOverride ? (
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-lg overflow-hidden border border-border/40 flex-shrink-0">
                    <img src={styleOverride.previewUrl} alt="Style override" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{styleOverride.file.name}</p>
                    <p className="text-xs text-muted-foreground">This image will be used as the style reference</p>
                  </div>
                  <Button type="button" size="icon" variant="ghost" className="h-8 w-8 flex-shrink-0" onClick={removeStyleOverride} disabled={isGenerating}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ) : (
                <label htmlFor="style-override-upload" className="cursor-pointer block">
                  <div className="flex flex-col items-center gap-2 py-4">
                    <Upload className="w-6 h-6 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground text-center">Click to upload a reference image for style override</p>
                  </div>
                  <input id="style-override-upload" type="file" accept="image/jpeg,image/png,image/jpg" className="hidden" onChange={handleStyleOverrideUpload} disabled={isGenerating} />
                </label>
              )}
            </div>
          </div>

          {/* Submit */}
          <div className="pt-2">
            <Button
              type="submit"
              className="w-full h-12 text-lg font-serif bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:scale-[1.01]"
              disabled={isGenerating}
            >
              {isGenerating ? (
                <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Generating Sketch...</>
              ) : (
                <><Wand2 className="mr-2 h-5 w-5" />Generate Design</>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
