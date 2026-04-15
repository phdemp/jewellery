import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { Loader2, Layers, ArrowLeft, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { MOTIF_GROUPS, STYLE_INSPIRATIONS } from "@/lib/jewellery-logic";
import { OrnamentalDivider } from "@/components/ornamental-divider";
import { CostReport } from "@/components/cost-report";
import { FeedbackForm } from "@/components/feedback-form";
import {
  generateCADComparison,
  SEGMENT_CATEGORY_PRICE_MAP,
  DESIGN_SHAPE_MAP,
  STONE_NAME_COLOUR_MAP,
  ALL_STONE_NAMES,
  STONE_SHAPE_GROUPS,
  stoneShapeSelectValue,
  parseStoneShapeValue,
  type CADComparisonResult,
  type CADComparisonParams,
} from "@/lib/api";

// ─── Constants ─────────────────────────────────────────────────────────────────

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

const CAD_MOTIF_GROUPS: Record<string, string[]> = {
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

// ─── Component ─────────────────────────────────────────────────────────────────

export default function CadComparison() {
  // Cascading dropdown state
  const [productSegment, setProductSegment] = useState("");
  const [category, setCategory] = useState("");
  const [priceBand, setPriceBand] = useState("");

  // Design parameter state
  const [selectedPolkiSizes, setSelectedPolkiSizes] = useState<string[]>([]);
  const [selectedPolkiSetting, setSelectedPolkiSetting] = useState<string>("");
  const [motifCategories, setMotifCategories] = useState<string[]>([]);
  const [selectedMotifs, setSelectedMotifs] = useState<string[]>([]);
  const [selectedStoneNames, setSelectedStoneNames] = useState<string[]>([]);
  const [selectedStoneColours, setSelectedStoneColours] = useState<string[]>([]);
  const [stoneShape, setStoneShape] = useState("");
  const [stoneSetting, setStoneSetting] = useState("");
  const [diamondSetting, setDiamondSetting] = useState("");
  const [materialRatio, setMaterialRatio] = useState("");
  const [enamel, setEnamel] = useState("");
  const [finish, setFinish] = useState("");
  const [designShape, setDesignShape] = useState("");
  const [styleInspiration, setStyleInspiration] = useState("");
  const [designType, setDesignType] = useState("");
  const [selectedTechniques, setSelectedTechniques] = useState<string[]>([]);
  const [earringStyle, setEarringStyle] = useState("");
  const [talaf, setTalaf] = useState("None");
  const [piroiPlacement, setPiroiPlacement] = useState("None");
  const [piroiColour, setPiroiColour] = useState("None");
  const [goldRatePerGram, setGoldRatePerGram] = useState(7000);
  const [goldPurity, setGoldPurity] = useState("18k");
  const [goldPercentage, setGoldPercentage] = useState(40);
  const [customNotes, setCustomNotes] = useState("");

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<CADComparisonResult | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const { toast } = useToast();
  const costReportRef = useRef<HTMLDivElement>(null);

  // Derive cascading options
  const availableCategories = productSegment
    ? (SEGMENT_CATEGORY_PRICE_MAP[productSegment] || []).map(e => e.category)
    : [];
  const availablePriceBands = productSegment && category
    ? (SEGMENT_CATEGORY_PRICE_MAP[productSegment] || []).find(e => e.category === category)?.price_bands || []
    : [];

  // Derive design shape + earring style from category
  const shapeEntry = category ? DESIGN_SHAPE_MAP[category] : null;
  const availableDesignShapes = shapeEntry?.shapes ?? DESIGN_SHAPES;
  const availableEarringStyles = shapeEntry?.earringStyles ?? [];

  // Colours available from selected stone names
  const availableStoneNameColours = selectedStoneNames.length > 0
    ? Array.from(new Set(selectedStoneNames.flatMap(n => STONE_NAME_COLOUR_MAP[n] ?? [])))
    : Array.from(new Set(Object.values(STONE_NAME_COLOUR_MAP).flat()));

  // Motif groups to display based on selected categories
  const availableMotifGroups = motifCategories.length === 0
    ? []
    : motifCategories.includes("Any")
      ? Object.entries(CAD_MOTIF_GROUPS).map(([group, motifs]) => ({ group, motifs }))
      : motifCategories
          .filter(cat => cat !== "No Motifs" && CAD_MOTIF_GROUPS[cat])
          .map(cat => ({ group: cat, motifs: CAD_MOTIF_GROUPS[cat] }));

  const handleSegmentChange = (value: string) => {
    setProductSegment(value);
    setCategory("");
    setPriceBand("");
  };

  const handleCategoryChange = (value: string) => {
    setCategory(value);
    setPriceBand("");
    setDesignShape("");
    setEarringStyle("");
  };

  const handleMotifCategoryToggle = (cat: string) => {
    setMotifCategories(prev => {
      if (prev.includes(cat)) {
        const next = prev.filter(c => c !== cat);
        // Clear motifs that are no longer available (unless "Any" is still selected)
        if (!next.includes("Any")) {
          const available = new Set(next.flatMap(c => CAD_MOTIF_GROUPS[c] ?? []));
          setSelectedMotifs(m => m.filter(mot => mot === "Any" || available.has(mot)));
        }
        return next;
      }
      if (cat === "Any") {
        return ["Any"];
      }
      if (cat === "No Motifs") {
        setSelectedMotifs([]);
        return ["No Motifs"];
      }
      const next = [...prev.filter(c => c !== "Any" && c !== "No Motifs"), cat];
      // Clear motifs that are no longer available
      const available = new Set(next.flatMap(c => CAD_MOTIF_GROUPS[c] ?? []));
      setSelectedMotifs(m => m.filter(mot => mot === "Any" || available.has(mot)));
      return next;
    });
  };

  const handleMotifToggle = (motif: string) => {
    setSelectedMotifs(prev => {
      if (prev.includes(motif)) return prev.filter(m => m !== motif);
      if (motif === "Any") return ["Any"];
      return [...prev.filter(m => m !== "Any"), motif];
    });
  };

  const handleStoneNameToggle = (name: string) => {
    setSelectedStoneNames(prev => {
      const next = prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name];
      // Drop colour selections that are no longer valid
      const validColours = new Set(next.flatMap(n => STONE_NAME_COLOUR_MAP[n] ?? []));
      setSelectedStoneColours(c => c.filter(col => validColours.has(col)));
      return next;
    });
  };

  const handleStoneColourToggle = (colour: string) => {
    setSelectedStoneColours(prev =>
      prev.includes(colour) ? prev.filter(c => c !== colour) : [...prev, colour]
    );
  };

  const handlePolkiSizeToggle = (size: string) => {
    setSelectedPolkiSizes(prev => {
      if (prev.includes(size)) return prev.filter(s => s !== size);
      if (size === "Any") return ["Any"];
      return [...prev.filter(s => s !== "Any"), size];
    });
  };

  const handleTechniqueToggle = (t: string) => {
    setSelectedTechniques(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
    );
  };

  const handleGenerate = async () => {
    if (!productSegment || !category) {
      toast({
        title: "Missing fields",
        description: "Please select Product Segment and Category",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setResult(null);
    setPromptExpanded(false);

    try {
      const noneToUndefined = (v: string) => (v && v !== "None" ? v : undefined);

      const params: CADComparisonParams = {
        productSegment,
        category,
        priceBand: priceBand || undefined,
        polkiSize: selectedPolkiSizes.length > 0 ? selectedPolkiSizes : undefined,
        polkiSetting: selectedPolkiSetting || undefined,
        motifCategory: motifCategories.length > 0 ? motifCategories : undefined,
        motifs: selectedMotifs.length > 0 ? selectedMotifs : undefined,
        stoneName: selectedStoneNames.length > 0 ? selectedStoneNames : undefined,
        stoneNameColour: selectedStoneColours.length > 0 ? selectedStoneColours : undefined,
        stoneShape: stoneShape ? parseStoneShapeValue(stoneShape) : undefined,
        stoneSetting: stoneSetting || undefined,
        diamondSetting: diamondSetting || undefined,
        materialRatio: materialRatio || undefined,
        enamel: enamel || undefined,
        finish: finish || undefined,
        designShape: designShape || undefined,
        styleInspiration: styleInspiration || undefined,
        designType: designType || undefined,
        techniques: selectedTechniques.length > 0 ? selectedTechniques : undefined,
        earringStyle: earringStyle || undefined,
        talaf: noneToUndefined(talaf),
        piroiPlacement: noneToUndefined(piroiPlacement),
        piroiColour: noneToUndefined(piroiColour),
        goldRatePerGram: goldRatePerGram > 0 ? goldRatePerGram : undefined,
        goldPurity: goldPurity || undefined,
        goldPercentage,
        customNotes: customNotes || undefined,
      };

      const data = await generateCADComparison(params);
      setResult(data);
      toast({ title: "CAD comparison ready!", description: "All renders generated successfully" });
      if (data.costReport) {
        setTimeout(() => costReportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
      }
    } catch (error: any) {
      toast({ title: "Generation failed", description: error.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30">
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-3">
              <Layers className="w-8 h-8 text-primary" />
              CAD Model Comparison
            </h1>
            <p className="text-muted-foreground mt-1">
              Compare Gemini, OpenAI, and Grok photorealistic CAD renders side-by-side
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Form */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="font-serif">Design Parameters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 1. Product Segment */}
              <div>
                <Label className="font-serif">Product Segment *</Label>
                <Select value={productSegment} onValueChange={handleSegmentChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select segment" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {PRODUCT_SEGMENTS.map(seg => (
                      <SelectItem key={seg} value={seg}>{seg}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 2. Category (cascaded) */}
              <div>
                <Label className="font-serif">Category *</Label>
                <Select value={category} onValueChange={handleCategoryChange} disabled={!productSegment}>
                  <SelectTrigger>
                    <SelectValue placeholder={productSegment ? "Select category" : "Select segment first"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {availableCategories.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Earring Style (only for Set categories) */}
              {availableEarringStyles.length > 0 && (
                <div>
                  <Label className="font-serif">Earring Style</Label>
                  <Select value={earringStyle} onValueChange={setEarringStyle}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select earring style" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableEarringStyles.map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* 3. Price Band (cascaded) */}
              <div>
                <Label className="font-serif">Price Band</Label>
                <Select value={priceBand} onValueChange={setPriceBand} disabled={!category}>
                  <SelectTrigger>
                    <SelectValue placeholder={category ? "Select price band" : "Select category first"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {availablePriceBands.map(band => (
                      <SelectItem key={band} value={band}>{band}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 4. Polki Size */}
              <div>
                <Label className="font-serif mb-2 block">Polki Size</Label>
                <div className="flex flex-wrap gap-2 border rounded-md p-2">
                  {POLKI_SIZES.map(size => (
                    <label key={size} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={selectedPolkiSizes.includes(size)}
                        onCheckedChange={() => handlePolkiSizeToggle(size)}
                      />
                      {size}
                    </label>
                  ))}
                </div>
              </div>

              {/* 4b. Polki Setting */}
              <div>
                <Label className="font-serif mb-2 block">Polki Setting</Label>
                <Select value={selectedPolkiSetting} onValueChange={setSelectedPolkiSetting}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select setting style" />
                  </SelectTrigger>
                  <SelectContent>
                    {POLKI_SETTINGS.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 5. Motif Category (multiselect) */}
              <div>
                <Label className="font-serif mb-2 block">Motif Category</Label>
                <div className="flex flex-wrap gap-2 border rounded-md p-2">
                  {MOTIF_CATEGORIES.map(cat => (
                    <label key={cat} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Checkbox
                        checked={motifCategories.includes(cat)}
                        onCheckedChange={() => handleMotifCategoryToggle(cat)}
                      />
                      {cat}
                    </label>
                  ))}
                </div>
                {motifCategories.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">{motifCategories.length} category(s) selected</p>
                )}
              </div>

              {/* 6. Motifs */}
              <div>
                <Label className="font-serif mb-2 block">Motifs</Label>
                <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-2">
                  {availableMotifGroups.length === 0 ? (
                    <p className="text-xs text-muted-foreground/60">
                      {motifCategories.includes("No Motifs")
                        ? "No Motifs selected — no motif will be applied"
                        : "Select motif categories above to see available motifs"}
                    </p>
                  ) : (
                    <>
                    <div className="pb-2 mb-1 border-b border-border/30">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <Checkbox
                          checked={selectedMotifs.includes("Any")}
                          onCheckedChange={() => handleMotifToggle("Any")}
                        />
                        <span className="font-medium">Any — AI's Choice</span>
                      </label>
                    </div>
                    {availableMotifGroups.map(({ group, motifs }) => (
                      <div key={group}>
                        <p className="text-xs font-semibold text-muted-foreground mb-1">{group}</p>
                        <div className="flex flex-wrap gap-1">
                          {motifs.map(motif => (
                            <label key={motif} className="flex items-center gap-2 text-sm cursor-pointer">
                              <Checkbox
                                checked={selectedMotifs.includes(motif)}
                                onCheckedChange={() => handleMotifToggle(motif)}
                              />
                              {motif}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                    </>
                  )}
                </div>
                {selectedMotifs.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">{selectedMotifs.length} motif(s) selected</p>
                )}
              </div>

              {/* 7. Stone Name */}
              <div>
                <Label className="font-serif mb-2 block">Stone Name</Label>
                <div className="flex flex-wrap gap-2 border rounded-md p-2 max-h-40 overflow-y-auto">
                  {ALL_STONE_NAMES.map(name => (
                    <label key={name} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Checkbox
                        checked={selectedStoneNames.includes(name)}
                        onCheckedChange={() => handleStoneNameToggle(name)}
                      />
                      {name}
                    </label>
                  ))}
                </div>
                {selectedStoneNames.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">{selectedStoneNames.length} stone(s) selected</p>
                )}
              </div>

              {/* 8. Stone Color (cascaded) */}
              <div>
                <Label className="font-serif mb-2 block">Stone Color</Label>
                <div className="flex flex-wrap gap-2 border rounded-md p-2 min-h-[40px]">
                  {availableStoneNameColours.map(colour => (
                    <label
                      key={colour}
                      className={`flex items-center gap-1.5 text-sm ${selectedStoneNames.length === 0 ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <Checkbox
                        checked={selectedStoneColours.includes(colour)}
                        onCheckedChange={() => handleStoneColourToggle(colour)}
                        disabled={selectedStoneNames.length === 0}
                      />
                      {colour}
                    </label>
                  ))}
                </div>
                {selectedStoneNames.length === 0 && (
                  <p className="text-xs text-muted-foreground/60 mt-1">Select stone names above to filter colours</p>
                )}
              </div>

              {/* 9. Stone Shape */}
              <div>
                <Label className="font-serif">Stone Shape</Label>
                <Select value={stoneShape} onValueChange={setStoneShape}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select stone shape" />
                  </SelectTrigger>
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

              {/* 9b. Stone Setting */}
              <div>
                <Label className="font-serif">Stone Setting</Label>
                <Select value={stoneSetting} onValueChange={setStoneSetting}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select setting style" />
                  </SelectTrigger>
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
              <div>
                <Label className="font-serif">Diamond Setting</Label>
                <Select value={diamondSetting} onValueChange={setDiamondSetting}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select diamond setting" />
                  </SelectTrigger>
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
              <div>
                <Label className="font-serif mb-2 block">Enamel</Label>
                <RadioGroup value={enamel} onValueChange={setEnamel} className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="Yes" id="cad-enamel-yes" />
                    <Label htmlFor="cad-enamel-yes" className="cursor-pointer">Yes</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="No" id="cad-enamel-no" />
                    <Label htmlFor="cad-enamel-no" className="cursor-pointer">No</Label>
                  </div>
                </RadioGroup>
              </div>

              {/* 11. Finish */}
              <div>
                <Label className="font-serif">Finish</Label>
                <Select value={finish} onValueChange={setFinish}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select finish" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {FINISHES.map(f => (
                      <SelectItem key={f} value={f}>{f}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Style Inspiration */}
              <div>
                <Label className="font-serif">Style Inspiration</Label>
                <Select value={styleInspiration} onValueChange={setStyleInspiration}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select style inspiration" />
                  </SelectTrigger>
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

              {/* 12. Design Shape */}
              <div>
                <Label className="font-serif">Design Shape</Label>
                <Select value={designShape} onValueChange={setDesignShape} disabled={!category}>
                  <SelectTrigger>
                    <SelectValue placeholder={category ? "Select design shape" : "Select category first"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {availableDesignShapes.map(shape => (
                      <SelectItem key={shape} value={shape}>{shape}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 12b. Design Type */}
              <div>
                <Label className="font-serif">Design Type</Label>
                <Select value={designType} onValueChange={setDesignType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select design type" />
                  </SelectTrigger>
                  <SelectContent>
                    {DESIGN_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* 12c. Techniques */}
              <div>
                <Label className="font-serif mb-2 block">Techniques</Label>
                <div className="flex flex-wrap gap-2 border rounded-md p-2">
                  {TECHNIQUES.map(t => (
                    <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={selectedTechniques.includes(t)}
                        onCheckedChange={() => handleTechniqueToggle(t)}
                      />
                      {t}
                    </label>
                  ))}
                </div>
                {selectedTechniques.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">{selectedTechniques.length} technique(s) selected</p>
                )}
              </div>

              {/* 13. Material Ratio */}
              <div>
                <Label className="font-serif">Material Ratio</Label>
                <Select value={materialRatio} onValueChange={setMaterialRatio}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select material ratio" />
                  </SelectTrigger>
                  <SelectContent>
                    {MATERIAL_RATIOS.map(r => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 14. Gold Rate */}
              <div>
                <Label className="font-serif">Gold Rate (₹/gram)</Label>
                <input
                  type="number"
                  min={1000}
                  value={goldRatePerGram}
                  onChange={e => setGoldRatePerGram(Number(e.target.value))}
                  placeholder="e.g. 7000"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">Enter today's 24k gold rate per gram</p>
              </div>

              {/* 15. Gold Purity */}
              <div>
                <Label className="font-serif mb-2 block">Gold Purity</Label>
                <div className="flex gap-2">
                  {(["9k", "14k", "18k", "22k"] as const).map(k => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setGoldPurity(k)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                        goldPurity === k
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
              <div>
                <Label className="font-serif mb-2 block">Gold vs Stone Allocation</Label>
                <input
                  type="range"
                  min={5}
                  max={95}
                  step={1}
                  value={goldPercentage}
                  onChange={e => setGoldPercentage(Number(e.target.value))}
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-amber-600 bg-gradient-to-r from-amber-200 to-emerald-200"
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span className="font-medium text-amber-700">Gold — {goldPercentage}%</span>
                  <span className="font-medium text-emerald-700">Stones — {100 - goldPercentage}%</span>
                </div>
              </div>

              {/* 17. Talaf */}
              <div>
                <Label className="font-serif">Talaf</Label>
                <Select value={talaf} onValueChange={setTalaf}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select talaf" />
                  </SelectTrigger>
                  <SelectContent>
                    {TALAFS.map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 18. Piroi Placement */}
              <div>
                <Label className="font-serif">Piroi Placement</Label>
                <Select value={piroiPlacement} onValueChange={setPiroiPlacement}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select piroi placement" />
                  </SelectTrigger>
                  <SelectContent>
                    {PIROI_PLACEMENTS.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 19. Piroi Colour */}
              <div>
                <Label className="font-serif">Piroi Colour</Label>
                <Select value={piroiColour} onValueChange={setPiroiColour}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select piroi colour" />
                  </SelectTrigger>
                  <SelectContent>
                    {PIROI_COLOURS.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 20. Custom Notes */}
              <div>
                <Label className="font-serif">Custom Notes</Label>
                <Textarea
                  placeholder="Any special instructions..."
                  value={customNotes}
                  onChange={e => setCustomNotes(e.target.value)}
                  className="resize-none"
                  rows={3}
                />
              </div>

              <Button onClick={handleGenerate} disabled={isGenerating || !productSegment || !category} className="w-full">
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating all renders...
                  </>
                ) : (
                  <>
                    <Layers className="w-4 h-4 mr-2" />
                    Generate CAD Comparison
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Results */}
          <div className="lg:col-span-2 space-y-6">
            {isGenerating && (
              <div className="flex items-center justify-center h-96 border-2 border-dashed rounded-xl">
                <div className="text-center">
                  <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-primary" />
                  <p className="text-muted-foreground font-medium">Generating all renders...</p>
                  <p className="text-sm text-muted-foreground mt-2">This may take 60-90 seconds</p>
                </div>
              </div>
            )}

            {result && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Gemini panel */}
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-serif text-lg font-semibold text-blue-700">Gemini</h3>
                      <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">{result.gemini.model}</Badge>
                    </div>
                    <div className="border rounded-lg overflow-hidden bg-white shadow-md">
                      {result.gemini.imageUrl ? (
                        <img src={result.gemini.imageUrl} alt="Gemini CAD render" className="w-full h-auto" />
                      ) : (
                        <div className="p-8 text-center">
                          <p className="text-sm text-destructive font-medium">Gemini Failed</p>
                          <p className="text-xs text-muted-foreground mt-1">{result.gemini.error}</p>
                        </div>
                      )}
                    </div>
                  </motion.div>

                  {/* OpenAI panel */}
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-serif text-lg font-semibold text-purple-700">OpenAI</h3>
                      <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">{result.openai.model}</Badge>
                    </div>
                    <div className="border rounded-lg overflow-hidden bg-white shadow-md">
                      {result.openai.imageUrl ? (
                        <img src={result.openai.imageUrl} alt="OpenAI CAD render" className="w-full h-auto" />
                      ) : (
                        <div className="p-8 text-center">
                          <p className="text-sm text-destructive font-medium">OpenAI Failed</p>
                          <p className="text-xs text-muted-foreground mt-1">{result.openai.error}</p>
                        </div>
                      )}
                    </div>
                  </motion.div>

                  {/* Grok panel */}
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-serif text-lg font-semibold text-orange-700">Grok</h3>
                      <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">{result.grok.model}</Badge>
                    </div>
                    <div className="border rounded-lg overflow-hidden bg-white shadow-md">
                      {result.grok.imageUrl ? (
                        <img src={result.grok.imageUrl} alt="Grok CAD render" className="w-full h-auto" />
                      ) : (
                        <div className="p-8 text-center">
                          <p className="text-sm text-destructive font-medium">Grok Failed</p>
                          <p className="text-xs text-muted-foreground mt-1">{result.grok.error}</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </div>

                {/* Shared prompt accordion */}
                <Card>
                  <CardContent className="p-0">
                    <button
                      onClick={() => setPromptExpanded(prev => !prev)}
                      className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <span>Shared CAD prompt used for all three models</span>
                      {promptExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    {promptExpanded && (
                      <div className="px-4 pb-4">
                        <pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/40 rounded p-3 max-h-64 overflow-y-auto">
                          {result.prompt}
                        </pre>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Cost Report */}
                {result.costReport && (
                  <>
                    <OrnamentalDivider className="my-4" />
                    <div ref={costReportRef} className="space-y-2 mb-4">
                      <h2 className="text-2xl font-serif text-foreground">Material Cost Breakdown</h2>
                      <p className="text-muted-foreground text-sm">AI-estimated material costs based on the generated design.</p>
                    </div>
                    <CostReport report={result.costReport} />
                  </>
                )}

                <FeedbackForm
                  category={category || "Necklace"}
                  theme={productSegment || "Modern"}
                />
              </>
            )}

            {!isGenerating && !result && (
              <div className="flex items-center justify-center h-96 border-2 border-dashed rounded-xl bg-muted/20">
                <div className="text-center">
                  <Layers className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p className="text-muted-foreground">
                    Select parameters and generate to compare all AI models
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
