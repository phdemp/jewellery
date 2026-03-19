import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, FlaskConical, ArrowLeft } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { CATEGORIES, THEMES, MATERIAL_RATIOS, MOTIF_GROUPS, getThemePromptValue } from "@/lib/jewellery-logic";

interface ComparisonResult {
  withReferences: {
    imageUrl: string;
    prompt: string;
    referencesUsed: number;
    references: Array<{
      description: string;
      similarity: number;
      lineStyle: string;
      coloringTechnique: string;
    }>;
  };
  withoutReferences: {
    imageUrl: string;
    prompt: string;
    referencesUsed: number;
  };
}

export default function Comparison() {
  const [category, setCategory] = useState("");
  const [theme, setTheme] = useState("");
  const [materialRatio, setMaterialRatio] = useState("");
  const [selectedMotifs, setSelectedMotifs] = useState<string[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const { toast } = useToast();

  const handleMotifToggle = (motif: string) => {
    setSelectedMotifs(prev =>
      prev.includes(motif) ? prev.filter(m => m !== motif) : [...prev, motif]
    );
  };

  const handleGenerate = async () => {
    if (!category || !theme || !materialRatio || selectedMotifs.length === 0) {
      toast({
        title: "Missing fields",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    setIsGenerating(true);
    setResult(null);

    try {
      const response = await fetch("/api/generate-comparison", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          theme: getThemePromptValue(theme),
          motifs: selectedMotifs,
          stones: [],
          materialRatio
        })
      });

      if (!response.ok) {
        throw new Error("Failed to generate comparison");
      }

      const data = await response.json();
      setResult(data);
      toast({ title: "Comparison generated!", description: "Both images are ready for comparison" });
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
            <Button variant="ghost" size="icon" data-testid="button-back-home">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-3">
              <FlaskConical className="w-8 h-8 text-primary" />
              Reference Library Comparison
            </h1>
            <p className="text-muted-foreground mt-1">
              Compare designs generated WITH and WITHOUT reference library influence
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="font-serif">Design Parameters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="font-serif">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger data-testid="select-category">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {CATEGORIES.map(cat => (
                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="font-serif">Theme</Label>
                <Select value={theme} onValueChange={setTheme}>
                  <SelectTrigger data-testid="select-theme">
                    <SelectValue placeholder="Select theme" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {THEMES.map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="font-serif">Price Range</Label>
                <Select value={materialRatio} onValueChange={setMaterialRatio}>
                  <SelectTrigger data-testid="select-material-ratio">
                    <SelectValue placeholder="Select price range" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[200px]">
                    {MATERIAL_RATIOS.map(ratio => (
                      <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="font-serif mb-2 block">Motifs</Label>
                <div className="max-h-48 overflow-y-auto border rounded-md p-2 space-y-2">
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

              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full"
                data-testid="button-generate-comparison"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating Both...
                  </>
                ) : (
                  <>
                    <FlaskConical className="w-4 h-4 mr-2" />
                    Generate Comparison
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <div className="lg:col-span-2">
            {isGenerating && (
              <div className="flex items-center justify-center h-96 border-2 border-dashed rounded-xl">
                <div className="text-center">
                  <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-primary" />
                  <p className="text-muted-foreground">Generating both designs for comparison...</p>
                  <p className="text-sm text-muted-foreground mt-2">This may take 1-2 minutes</p>
                </div>
              </div>
            )}

            {result && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-serif text-lg font-semibold text-green-700">
                      With References
                    </h3>
                    <Badge variant="secondary" className="bg-green-100 text-green-800">
                      {result.withReferences.referencesUsed} refs used
                    </Badge>
                  </div>
                  <div className="border rounded-lg overflow-hidden bg-white shadow-md">
                    <img
                      src={result.withReferences.imageUrl}
                      alt="Design with references"
                      className="w-full h-auto"
                      data-testid="img-with-references"
                    />
                  </div>
                  {result.withReferences.references.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">References Used:</p>
                      {result.withReferences.references.map((ref, i) => (
                        <div key={i} className="text-xs p-2 bg-muted/50 rounded">
                          <div className="flex justify-between mb-1">
                            <span className="font-medium">Reference {i + 1}</span>
                            <Badge variant="outline" className="text-xs">
                              {ref.similarity}% match
                            </Badge>
                          </div>
                          <p className="text-muted-foreground">{ref.description || "Reference design"}</p>
                          {ref.lineStyle && (
                            <p className="mt-1"><strong>Lines:</strong> {ref.lineStyle}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-serif text-lg font-semibold text-orange-700">
                      Without References
                    </h3>
                    <Badge variant="secondary" className="bg-orange-100 text-orange-800">
                      Defaults only
                    </Badge>
                  </div>
                  <div className="border rounded-lg overflow-hidden bg-white shadow-md">
                    <img
                      src={result.withoutReferences.imageUrl}
                      alt="Design without references"
                      className="w-full h-auto"
                      data-testid="img-without-references"
                    />
                  </div>
                  <div className="text-xs p-2 bg-muted/50 rounded">
                    <p className="text-muted-foreground">
                      This design was generated using only the default style settings
                      without any influence from the reference library.
                    </p>
                  </div>
                </motion.div>
              </div>
            )}

            {!isGenerating && !result && (
              <div className="flex items-center justify-center h-96 border-2 border-dashed rounded-xl bg-muted/20">
                <div className="text-center">
                  <FlaskConical className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                  <p className="text-muted-foreground">
                    Select parameters and generate to see the comparison
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
