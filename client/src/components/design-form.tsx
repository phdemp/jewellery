import { useState } from "react";
import { useForm } from "react-hook-form";
import { Loader2, Wand2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DesignRequest } from "@/lib/jewellery-logic";
import { SEGMENT_CATEGORY_PRICE_MAP } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

// ─── Constants (same as modify.tsx / cad-comparison.tsx) ─────────────────────

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

// ─── Form types ──────────────────────────────────────────────────────────────

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

  const { watch, setValue, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: {
      productSegment: "",
      category: "",
      priceBand: "",
      polkiSize: "",
      motifCategory: "",
      motifs: [],
      stoneColour: [],
      enamel: "",
      finish: "",
      designShape: "",
      materialRatio: "",
      talaf: "None",
      piroiPlacement: "None",
      piroiColour: "None",
      customNotes: "",
    },
  });

  const watchedSegment = watch("productSegment");
  const watchedCategory = watch("category");
  const watchedMotifs = watch("motifs") || [];
  const watchedStones = watch("stoneColour") || [];

  // Cascading dropdown options
  const availableCategories = watchedSegment
    ? (SEGMENT_CATEGORY_PRICE_MAP[watchedSegment] || []).map(e => e.category)
    : [];
  const availablePriceBands = watchedSegment && watchedCategory
    ? (SEGMENT_CATEGORY_PRICE_MAP[watchedSegment] || []).find(e => e.category === watchedCategory)?.price_bands || []
    : [];

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

  function toggleArrayValue(field: "motifs" | "stoneColour", value: string) {
    const current = watch(field) || [];
    if (current.includes(value)) {
      setValue(field, current.filter((v: string) => v !== value));
    } else {
      setValue(field, [...current, value]);
    }
  }

  function onFormSubmit(values: FormValues) {
    if (!values.productSegment || !values.category) {
      toast({ title: "Missing fields", description: "Please select Product Segment and Category.", variant: "destructive" });
      return;
    }

    const data: DesignRequest = {
      productSegment: values.productSegment || undefined,
      category: values.category,
      priceBand: values.priceBand || undefined,
      polkiSize: values.polkiSize || undefined,
      motifCategory: values.motifCategory || undefined,
      motifs: values.motifs || [],
      stoneColour: values.stoneColour.length > 0 ? values.stoneColour : undefined,
      enamel: values.enamel || undefined,
      finish: values.finish || undefined,
      designShape: values.designShape || undefined,
      materialRatio: values.materialRatio || undefined,
      talaf: values.talaf !== "None" ? values.talaf : undefined,
      piroiPlacement: values.piroiPlacement !== "None" ? values.piroiPlacement : undefined,
      piroiColour: values.piroiColour !== "None" ? values.piroiColour : undefined,
      customNotes: values.customNotes || undefined,
    };

    onSubmit(data, styleOverride?.file);
  }

  // Shared select styling
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
            <Select value={watchedCategory} onValueChange={(v) => { setValue("category", v); setValue("priceBand", ""); }} disabled={!watchedSegment}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder={watchedSegment ? "Select category" : "Select segment first"} /></SelectTrigger>
              <SelectContent className="max-h-[200px]">
                {availableCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

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
            <Select value={watch("polkiSize")} onValueChange={(v) => setValue("polkiSize", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select polki size" /></SelectTrigger>
              <SelectContent>
                {POLKI_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 5. Motif Category */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Motif Category</Label>
            <Select value={watch("motifCategory")} onValueChange={(v) => setValue("motifCategory", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select motif category" /></SelectTrigger>
              <SelectContent>
                {MOTIF_CATEGORIES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 6. Motifs (grouped checkboxes) */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Motifs</Label>
            <div className="space-y-4 max-h-64 overflow-y-auto p-3 border border-border/40 rounded-md bg-white/40">
              {Object.entries(MOTIF_GROUPS).map(([groupName, motifs]) => (
                <div key={groupName} className="space-y-2">
                  <h4 className="text-sm font-semibold text-foreground/80 border-b border-border/30 pb-1">{groupName}</h4>
                  <div className="grid grid-cols-2 gap-1">
                    {motifs.map((motif) => (
                      <label key={motif} className="flex items-center gap-2 rounded-md border border-transparent hover:bg-secondary/20 p-2 transition-colors cursor-pointer">
                        <Checkbox
                          checked={watchedMotifs.includes(motif)}
                          onCheckedChange={() => toggleArrayValue("motifs", motif)}
                          className="border-primary/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                        />
                        <span className="text-sm">{motif}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 7. Stone Colour (multi checkboxes) */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Stone Colour</Label>
            <div className="grid grid-cols-2 gap-1 p-3 border border-border/40 rounded-md bg-white/40">
              {STONE_COLOURS.map((colour) => (
                <label key={colour} className="flex items-center gap-2 rounded-md border border-transparent hover:bg-secondary/20 p-2 transition-colors cursor-pointer">
                  <Checkbox
                    checked={watchedStones.includes(colour)}
                    onCheckedChange={() => toggleArrayValue("stoneColour", colour)}
                    className="border-primary/40 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                  <span className="text-sm">{colour}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 8. Enamel */}
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

          {/* 9. Finish */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Finish</Label>
            <Select value={watch("finish")} onValueChange={(v) => setValue("finish", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select finish" /></SelectTrigger>
              <SelectContent>
                {FINISHES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 10. Design Shape */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Design Shape</Label>
            <Select value={watch("designShape")} onValueChange={(v) => setValue("designShape", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select design shape" /></SelectTrigger>
              <SelectContent className="max-h-[200px]">
                {DESIGN_SHAPES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 11. Material Ratio */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Material Ratio</Label>
            <Select value={watch("materialRatio")} onValueChange={(v) => setValue("materialRatio", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select material ratio" /></SelectTrigger>
              <SelectContent>
                {MATERIAL_RATIOS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 12. Talaf */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Talaf</Label>
            <Select value={watch("talaf")} onValueChange={(v) => setValue("talaf", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select talaf" /></SelectTrigger>
              <SelectContent>
                {TALAFS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 13. Piroi Placement */}
          <div className="space-y-2">
            <Label className="font-serif text-base">Piroi Placement</Label>
            <Select value={watch("piroiPlacement")} onValueChange={(v) => setValue("piroiPlacement", v)}>
              <SelectTrigger className={selectTriggerClass}><SelectValue placeholder="Select piroi placement" /></SelectTrigger>
              <SelectContent>
                {PIROI_PLACEMENTS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* 14. Piroi Colour */}
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
