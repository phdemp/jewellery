import { motion } from "framer-motion";
import { Download, Copy, Maximize2, Pencil, Loader2, History, ChevronLeft, ChevronRight, Save, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { type DesignGenerationResponse, type DesignIteration, editDesign, getDesignIterations, saveDesign } from "@/lib/api";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

import sketchBg from "@assets/generated_images/elegant_jewellery_sketch_background_texture.png";

interface ResultDisplayProps {
  result: DesignGenerationResponse | null;
  category: string;
}

export function ResultDisplay({ result, category }: ResultDisplayProps) {
  const [editPrompt, setEditPrompt] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [iterations, setIterations] = useState<DesignIteration[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const { toast } = useToast();

  const allImages = result ? [
    { url: result.generatedImageUrl, label: "Original", prompt: null },
    ...iterations.map((it, i) => ({ 
      url: it.resultImageUrl, 
      label: `Edit ${i + 1}`, 
      prompt: it.editPrompt 
    }))
  ] : [];

  const currentImage = allImages[currentImageIndex]?.url || result?.generatedImageUrl;

  useEffect(() => {
    if (result?.id) {
      getDesignIterations(result.id).then(setIterations).catch(console.error);
      setCurrentImageIndex(0);
      setSavedPath(null); // Reset saved state for new design
    }
  }, [result?.id]);

  useEffect(() => {
    if (iterations.length > 0) {
      setCurrentImageIndex(iterations.length);
    }
  }, [iterations.length]);

  const handleEdit = async () => {
    if (!result?.id || !editPrompt.trim()) return;
    
    setIsEditing(true);
    try {
      const newIteration = await editDesign(result.id, editPrompt);
      setIterations(prev => [...prev, newIteration]);
      setEditPrompt("");
      setIsSheetOpen(false);
      toast({ title: "Design updated!", description: "Your edit has been applied." });
    } catch (error: any) {
      toast({ title: "Edit failed", description: error.message, variant: "destructive" });
    } finally {
      setIsEditing(false);
    }
  };

  const handleSave = async () => {
    if (!result?.id) return;
    
    setIsSaving(true);
    try {
      // Pass the current image index (0 = original, 1+ = iterations)
      const saveResult = await saveDesign(result.id, currentImageIndex);
      setSavedPath(saveResult.folder);
      toast({ 
        title: "Design saved!", 
        description: `Saved to ${saveResult.folder}` 
      });
    } catch (error: any) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  if (!result) {
    return (
      <div className="h-full min-h-[600px] flex items-center justify-center border-2 border-dashed border-border/60 rounded-xl bg-white/40 p-8">
        <div className="text-center space-y-4 max-w-md">
          <div className="w-64 h-64 mx-auto opacity-50 mb-6 rounded-full overflow-hidden border-4 border-white shadow-inner">
            <img src={sketchBg} alt="Placeholder" className="w-full h-full object-cover" />
          </div>
          <h3 className="font-serif text-2xl text-muted-foreground">Ready to Design</h3>
          <p className="text-muted-foreground/80">
            Select your parameters on the left to generate a bespoke jewellery design sketch.
          </p>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      <div className="bg-white border border-border/60 shadow-lg rounded-xl overflow-hidden">
        <div className="w-full relative group bg-[#FDFBF7] min-h-[400px]">
          <img
            src={currentImage}
            alt="Generated Sketch"
            className="w-full h-auto object-contain p-4 mix-blend-multiply transition-transform duration-700 group-hover:scale-105"
            data-testid="img-generated-sketch"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          
          {allImages.length > 1 && (
            <div className="absolute bottom-4 left-4 flex items-center gap-2">
              <Button
                size="icon"
                variant="secondary"
                className="bg-white/90 shadow-sm hover:bg-white h-8 w-8"
                onClick={() => setCurrentImageIndex(i => Math.max(0, i - 1))}
                disabled={currentImageIndex === 0}
                data-testid="button-prev-version"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium bg-white/90 px-2 py-1 rounded shadow-sm">
                {allImages[currentImageIndex]?.label}
              </span>
              <Button
                size="icon"
                variant="secondary"
                className="bg-white/90 shadow-sm hover:bg-white h-8 w-8"
                onClick={() => setCurrentImageIndex(i => Math.min(allImages.length - 1, i + 1))}
                disabled={currentImageIndex === allImages.length - 1}
                data-testid="button-next-version"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
          
          <div className="absolute bottom-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity translate-y-2 group-hover:translate-y-0 duration-300">
            <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
              <SheetTrigger asChild>
                <Button 
                  size="icon" 
                  variant="secondary" 
                  className="bg-white/90 shadow-sm hover:bg-white"
                  data-testid="button-edit-design"
                >
                  <Pencil className="w-4 h-4 text-foreground" />
                </Button>
              </SheetTrigger>
              <SheetContent className="w-[400px] sm:w-[540px]">
                <SheetHeader>
                  <SheetTitle className="font-serif">Refine Design</SheetTitle>
                </SheetHeader>
                <div className="mt-6 space-y-4">
                  <div className="aspect-video rounded-lg overflow-hidden bg-[#FDFBF7] border">
                    <img src={currentImage} alt="Current design" className="w-full h-full object-contain" />
                  </div>
                  <Textarea
                    placeholder="Describe the changes you want... (e.g., 'Make the stones larger', 'Add more pearls', 'Change to a longer design')"
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    className="min-h-[100px]"
                    data-testid="input-edit-prompt"
                  />
                  <Button 
                    onClick={handleEdit} 
                    disabled={isEditing || !editPrompt.trim()}
                    className="w-full"
                    data-testid="button-apply-edit"
                  >
                    {isEditing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Applying Changes...
                      </>
                    ) : (
                      <>
                        <Pencil className="w-4 h-4 mr-2" />
                        Apply Changes
                      </>
                    )}
                  </Button>
                  {iterations.length > 0 && (
                    <div className="pt-4 border-t">
                      <h4 className="font-medium text-sm text-muted-foreground mb-3 flex items-center gap-2">
                        <History className="w-4 h-4" /> Edit History
                      </h4>
                      <div className="space-y-2 max-h-[200px] overflow-y-auto">
                        {iterations.map((it, i) => (
                          <div 
                            key={it.id}
                            className="text-sm p-2 rounded bg-muted/50 cursor-pointer hover:bg-muted"
                            onClick={() => { setCurrentImageIndex(i + 1); setIsSheetOpen(false); }}
                          >
                            <span className="font-medium">Edit {i + 1}:</span> {it.editPrompt}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </SheetContent>
            </Sheet>
            <Button 
              size="icon" 
              variant="secondary" 
              className="bg-white/90 shadow-sm hover:bg-white"
              onClick={() => {
                if (!currentImage) return;
                const link = document.createElement('a');
                link.href = currentImage;
                link.download = `jewellery-design-${Date.now()}.png`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
              data-testid="button-download-sketch"
            >
              <Download className="w-4 h-4 text-foreground" />
            </Button>
            <Button 
              size="icon" 
              variant="secondary" 
              className={`shadow-sm ${savedPath ? 'bg-green-100 hover:bg-green-200' : 'bg-white/90 hover:bg-white'}`}
              onClick={handleSave}
              disabled={isSaving}
              data-testid="button-save-design"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 text-foreground animate-spin" />
              ) : savedPath ? (
                <Check className="w-4 h-4 text-green-600" />
              ) : (
                <Save className="w-4 h-4 text-foreground" />
              )}
            </Button>
            <Button 
              size="icon" 
              variant="secondary" 
              className="bg-white/90 shadow-sm hover:bg-white"
              onClick={() => window.open(currentImage, '_blank')}
              data-testid="button-maximize-sketch"
            >
              <Maximize2 className="w-4 h-4 text-foreground" />
            </Button>
          </div>

          <div className="absolute top-4 left-4">
             <Badge variant="secondary" className="bg-white/80 backdrop-blur-sm border-border/50 text-foreground font-serif tracking-wide px-3 py-1">
               {allImages[currentImageIndex]?.label || "AI Generated Sketch"}
             </Badge>
          </div>
        </div>
      </div>

      
    </motion.div>
  );
}
