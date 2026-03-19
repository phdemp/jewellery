import { useState } from "react";
import { Layout } from "@/components/layout";
import { OrnamentalDivider } from "@/components/ornamental-divider";
import { DesignForm } from "@/components/design-form";
import { ResultDisplay } from "@/components/result-display";
import { DesignRequest } from "@/lib/jewellery-logic";
import { useToast } from "@/hooks/use-toast";
import { generateDesign, type DesignGenerationResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function Home() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<DesignGenerationResponse | null>(null);
  const [lastCategory, setLastCategory] = useState<string>("");
  const [mode, setMode] = useState<"sketch" | "cad">("sketch");
  const { toast } = useToast();

  const handleGenerate = async (data: DesignRequest, styleOverride?: File) => {
    setIsGenerating(true);
    setLastCategory(data.category);

    try {
      const generated = await generateDesign({ ...data, mode }, styleOverride);
      setResult(generated);
      const outputLabel = mode === "cad" ? "CAD render" : "sketch";
      toast({
        title: "Design Generated",
        description: styleOverride
          ? `Your custom jewellery ${outputLabel} is ready using your uploaded style reference.`
          : `Your custom jewellery ${outputLabel} is ready${generated.usedReferences > 0 ? ` (informed by ${generated.usedReferences} reference${generated.usedReferences > 1 ? 's' : ''})` : ''}.`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to generate design. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Layout>
      <div className="text-center py-8 mb-4">
        <p className="font-serif text-xl italic text-muted-foreground tracking-wide">
          Design to Inspire, Legacy to Celebrate
        </p>
        <OrnamentalDivider className="mt-3" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 max-w-7xl mx-auto">
        
        {/* Left Column: Input */}
        <div className="lg:col-span-5 space-y-6">
          <div className="space-y-2 mb-6">
            <h2 className="text-3xl font-serif text-foreground">Design Studio</h2>
            <p className="text-muted-foreground">
              Define your jewellery concept using our curated design parameters.
            </p>
          </div>

          {/* Output mode toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("sketch")}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium border transition-colors",
                mode === "sketch"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-secondary/40"
              )}
            >
              Sketch
            </button>
            <button
              type="button"
              onClick={() => setMode("cad")}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium border transition-colors",
                mode === "cad"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:bg-secondary/40"
              )}
            >
              CAD Render
            </button>
          </div>

          <DesignForm onSubmit={handleGenerate} isGenerating={isGenerating} />
        </div>

        {/* Right Column: Output */}
        <div className="lg:col-span-7">
           <div className="space-y-2 mb-6 lg:text-right">
            <h2 className="text-3xl font-serif text-foreground">
              {mode === "cad" ? "CAD Render" : "Sketchpad"}
            </h2>
            <p className="text-muted-foreground">
              Visualized output and technical generation details.
            </p>
          </div>
          <ResultDisplay result={result} category={lastCategory} />
        </div>
      </div>
    </Layout>
  );
}
