import { useState } from "react";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { MOTIF_GROUPS } from "@/lib/jewellery-logic";
import {
  generateCADComparison,
  SEGMENT_CATEGORY_PRICE_MAP,
  type CADComparisonResult,
  type CADComparisonParams,
} from "@/lib/api";

// ─── Constants (same as modify page) ──────────────────────────────────────────

const PRODUCT_SEGMENTS = Object.keys(SEGMENT_CATEGORY_PRICE_MAP);

const POLKI_SIZES = ["Far", "Big", "Normal"];

const MOTIF_CATEGORIES = [
  "Animal & Bird", "Celestial & Spiritual", "Contemporary Luxury",
  "Forms & Shapes", "Nature - Inspired", "Multiple Choice", "No Motifs",
];

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

const TALAFS = ["None", "Talaf-Red", "Talaf-Green", "Talaf-Blue", "Talaf-Pink"];
const PIROI_PLACEMENTS = ["None", "Top", "Front", "Back", "Latkan"];
const PIROI_COLOURS = ["None", "Red", "Green", "Blue", "White", "Pink"];

// ─── Component ────────────────────────────────────────────────────────────────

export default function CadComparison() {
  // Cascading dropdown state
  const [productSegment, setProductSegment] = useState("");
  const [category, setCategory] = useState("");
  const [priceBand, setPriceBand] = useState("");

  // Design parameter state
  const [polkiSize, setPolkiSize] = useState("");
  const [motifCategory, setMotifCategory] = useState("");
  const [selectedMotifs, setSelectedMotifs] = useState<string[]>([]);
  const [selectedStoneColours, setSelectedStoneColours] = useState<string[]>([]);
  const [enamel, setEnamel] = useState("");
  const [finish, setFinish] = useState("");
  const [designShape, setDesignShape] = useState("");
  const [talaf, setTalaf] = useState("None");
  const [piroiPlacement, setPiroiPlacement] = useState("None");
  const [piroiColour, setPiroiColour] = useState("None");
  const [customNotes, setCustomNotes] = useState("");

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<CADComparisonResult | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const { toast } = useToast();

  // Derive cascading options
  const availableCategories = productSegment
    ? (SEGMENT_CATEGORY_PRICE_MAP[productSegment] || []).map(e => e.category)
    : [];
  const availablePriceBands = productSegment && category
    ? (SEGMENT_CATEGORY_PRICE_MAP[productSegment] || []).find(e => e.category === category)?.price_bands || []
    : [];

  const handleSegmentChange = (value: string) => {
    setProductSegment(value);
    setCategory("");
    setPriceBand("");
  };

  const handleCategoryChange = (value: string) => {
    setCategory(value);
    setPriceBand("");
  };

  const handleMotifToggle = (motif: string) => {
    setSelectedMotifs(prev =>
      prev.includes(motif) ? prev.filter(m => m !== motif) : [...prev, motif]
    );
  };

  const handleStoneColourToggle = (colour: string) => {
    setSelectedStoneColours(prev =>
      prev.includes(colour) ? prev.filter(c => c !== colour) : [...prev, colour]
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
        polkiSize: polkiSize || undefined,
        motifCategory: motifCategory || undefined,
        motifs: selectedMotifs.length > 0 ? selectedMotifs : undefined,
        stoneColour: selectedStoneColours.length > 0 ? selectedStoneColours : undefined,
        enamel: enamel || undefined,
        finish: finish || undefined,
        designShape: designShape || undefined,
        talaf: noneToUndefined(talaf),
        piroiPlacement: noneToUndefined(piroiPlacement),
        piroiColour: noneToUndefined(piroiColour),
        customNotes: customNotes || undefined,
      };

      const data = await generateCADComparison(params);
      setResult(data);
      toast({ title: "CAD comparison ready!", description: "Both renders generated successfully" });
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
              Compare Gemini 3 Pro vs OpenAI gpt-image-1 photorealistic CAD renders side-by-side
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
                <Select
                  value={category}
                  onValueChange={handleCategoryChange}
                  disabled={!productSegment}
                >
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

              {/* 3. Price Band (cascaded) */}
              <div>
                <Label className="font-serif">Price Band</Label>
                <Select
                  value={priceBand}
                  onValueChange={setPriceBand}
                  disabled={!category}
                >
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
                <Label className="font-serif">Polki Size</Label>
                <Select value={polkiSize} onValueChange={setPolkiSize}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select polki size" />
                  </SelectTrigger>
                  <SelectContent>
                    {POLKI_SIZES.map(size => (
                      <SelectItem key={size} value={size}>{size}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 5. Motif Category */}
              <div>
                <Label className="font-serif">Motif Category</Label>
                <Select value={motifCategory} onValueChange={setMotifCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select motif category" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {MOTIF_CATEGORIES.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 7. Motifs */}
              <div>
                <Label className="font-serif mb-2 block">Motifs</Label>
                <div className="max-h-40 overflow-y-auto border rounded-md p-2 space-y-2">
                  {Object.entries(MOTIF_GROUPS).map(([groupName, motifs]) => (
                    <div key={groupName}>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">{groupName}</p>
                      <div className="grid grid-cols-2 gap-1">
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
                </div>
              </div>

              {/* 8. Stone Colour */}
              <div>
                <Label className="font-serif mb-2 block">Stone Colour</Label>
                <div className="grid grid-cols-2 gap-1 border rounded-md p-2">
                  {STONE_COLOURS.map(colour => (
                    <label key={colour} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={selectedStoneColours.includes(colour)}
                        onCheckedChange={() => handleStoneColourToggle(colour)}
                      />
                      {colour}
                    </label>
                  ))}
                </div>
              </div>

              {/* 9. Enamel */}
              <div>
                <Label className="font-serif mb-2 block">Enamel</Label>
                <RadioGroup value={enamel} onValueChange={setEnamel} className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="Yes" id="enamel-yes" />
                    <Label htmlFor="enamel-yes" className="cursor-pointer">Yes</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="No" id="enamel-no" />
                    <Label htmlFor="enamel-no" className="cursor-pointer">No</Label>
                  </div>
                </RadioGroup>
              </div>

              {/* 10. Finish */}
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

              {/* 11. Design Shape */}
              <div>
                <Label className="font-serif">Design Shape</Label>
                <Select value={designShape} onValueChange={setDesignShape}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select design shape" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {DESIGN_SHAPES.map(shape => (
                      <SelectItem key={shape} value={shape}>{shape}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 12. Talaf */}
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

              {/* 13. Piroi Placement */}
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

              {/* 14. Piroi Colour */}
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

              {/* 15. Custom Notes */}
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

              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating both renders...
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
                  <p className="text-muted-foreground font-medium">Generating both renders...</p>
                  <p className="text-sm text-muted-foreground mt-2">This may take 60-90 seconds</p>
                </div>
              </div>
            )}

            {result && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Gemini panel */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-serif text-lg font-semibold text-blue-700">
                        Gemini 3 Pro
                      </h3>
                      <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
                        {result.gemini.model}
                      </Badge>
                    </div>
                    <div className="border rounded-lg overflow-hidden bg-white shadow-md">
                      <img
                        src={result.gemini.imageUrl}
                        alt="Gemini CAD render"
                        className="w-full h-auto"
                      />
                    </div>
                  </motion.div>

                  {/* OpenAI panel */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-serif text-lg font-semibold text-purple-700">
                        OpenAI gpt-image-1
                      </h3>
                      <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">
                        {result.openai.model}
                      </Badge>
                    </div>
                    <div className="border rounded-lg overflow-hidden bg-white shadow-md">
                      <img
                        src={result.openai.imageUrl}
                        alt="OpenAI CAD render"
                        className="w-full h-auto"
                      />
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
                      <span>Shared CAD prompt used for both models</span>
                      {promptExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
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
              </>
            )}

            {!isGenerating && !result && (
              <div className="flex items-center justify-center h-96 border-2 border-dashed rounded-xl bg-muted/20">
                <div className="text-center">
                  <Layers className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p className="text-muted-foreground">
                    Select parameters and generate to compare both AI models
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
