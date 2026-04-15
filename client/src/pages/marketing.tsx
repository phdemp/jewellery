import { useState, useRef, useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Layout } from "@/components/layout";
import { OrnamentalDivider } from "@/components/ornamental-divider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { FeedbackForm } from "@/components/feedback-form";
import {
  generateMarketingVisual,
  MARKETING_FORM_OPTIONS,
  type MarketingVisualResponse,
} from "@/lib/api";
import { motion } from "framer-motion";
import { Upload, X, Download, ChevronDown, Loader2, ImageIcon } from "lucide-react";

const formSchema = z.object({
  jewelleryCategory: z.string().min(1, "Required"),
  modelEthnicity: z.string().min(1, "Required"),
  modelStyle: z.string().min(1, "Required"),
  backgroundSetting: z.string().min(1, "Required"),
  lightingMood: z.string().min(1, "Required"),
  outfitStyle: z.string().min(1, "Required"),
  composition: z.string().min(1, "Required"),
  customNotes: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

function SelectField({
  label,
  options,
  value,
  onChange,
  placeholder,
  error,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={error ? "border-destructive" : ""}>
          <SelectValue placeholder={placeholder || `Select ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export default function MarketingPage() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<MarketingVisualResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [promptVisible, setPromptVisible] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      jewelleryCategory: "",
      modelEthnicity: "",
      modelStyle: "",
      backgroundSetting: "",
      lightingMood: "",
      outfitStyle: "",
      composition: "",
      customNotes: "",
    },
  });

  // Cleanup object URL on unmount or when previewUrl changes
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFileSelect = useCallback((file: File) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a JPEG, PNG, or WebP image.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Please upload an image under 10 MB.",
        variant: "destructive",
      });
      return;
    }
    setUploadedFile(file);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  }, [toast]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const clearFile = () => {
    setUploadedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onSubmit = async (data: FormValues) => {
    if (!uploadedFile) {
      toast({
        title: "Image required",
        description: "Please upload a jewellery image first.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      const response = await generateMarketingVisual(uploadedFile, data);
      setResult(response);
      toast({
        title: "Marketing Visuals Generated",
        description: "Both AI models have produced their interpretations.",
      });
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to generate marketing visual.";
      toast({
        title: "Generation Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const downloadImage = (url: string, modelName: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `raniwala-${modelName}-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <Layout>
      <div className="text-center py-8 mb-4">
        <p className="font-serif text-xl italic text-muted-foreground tracking-wide">
          Marketing Visual Generator
        </p>
        <OrnamentalDivider className="mt-3" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 max-w-7xl mx-auto">
        {/* Left Column: Upload + Form */}
        <div className="lg:col-span-5 space-y-6">
          <div className="space-y-2 mb-6">
            <h2 className="text-3xl font-serif text-foreground">Campaign Setup</h2>
            <p className="text-muted-foreground">
              Upload a jewellery product photo and define the editorial direction.
            </p>
          </div>

          {/* Image Upload Panel */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Jewellery Product Photo</Label>
            {!uploadedFile ? (
              <div
                className="border-2 border-dashed border-primary/40 rounded-lg p-8 text-center cursor-pointer hover:border-primary/70 hover:bg-primary/5 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <Upload className="mx-auto h-10 w-10 text-primary/50 mb-3" />
                <p className="text-sm font-medium text-foreground">
                  Click to browse or drag & drop
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  JPEG, PNG, or WebP
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                />
              </div>
            ) : (
              <div className="border border-border rounded-lg p-3 bg-background">
                <div className="relative">
                  <img
                    src={previewUrl!}
                    alt="Uploaded jewellery"
                    className="w-full max-h-[200px] object-contain rounded"
                  />
                  <Button
                    size="icon"
                    variant="destructive"
                    className="absolute top-1 right-1 h-7 w-7"
                    onClick={clearFile}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate">{uploadedFile.name}</span>
                  <span>{(uploadedFile.size / 1024).toFixed(0)} KB</span>
                </div>
              </div>
            )}
          </div>

          {/* Parameter Form */}
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <SelectField
              label="Jewellery Category"
              options={MARKETING_FORM_OPTIONS.jewelleryCategory}
              value={form.watch("jewelleryCategory")}
              onChange={(val) => form.setValue("jewelleryCategory", val, { shouldValidate: true })}
              error={form.formState.errors.jewelleryCategory?.message}
            />

            <SelectField
              label="Model Ethnicity"
              options={MARKETING_FORM_OPTIONS.modelEthnicity}
              value={form.watch("modelEthnicity")}
              onChange={(val) => form.setValue("modelEthnicity", val, { shouldValidate: true })}
              error={form.formState.errors.modelEthnicity?.message}
            />

            <SelectField
              label="Overall Style & Setting"
              options={MARKETING_FORM_OPTIONS.modelStyle}
              value={form.watch("modelStyle")}
              onChange={(val) => form.setValue("modelStyle", val, { shouldValidate: true })}
              error={form.formState.errors.modelStyle?.message}
            />

            <SelectField
              label="Background Setting"
              options={MARKETING_FORM_OPTIONS.backgroundSetting}
              value={form.watch("backgroundSetting")}
              onChange={(val) => form.setValue("backgroundSetting", val, { shouldValidate: true })}
              error={form.formState.errors.backgroundSetting?.message}
            />

            <SelectField
              label="Lighting Mood"
              options={MARKETING_FORM_OPTIONS.lightingMood}
              value={form.watch("lightingMood")}
              onChange={(val) => form.setValue("lightingMood", val, { shouldValidate: true })}
              error={form.formState.errors.lightingMood?.message}
            />

            <SelectField
              label="Outfit Style"
              options={MARKETING_FORM_OPTIONS.outfitStyle}
              value={form.watch("outfitStyle")}
              onChange={(val) => form.setValue("outfitStyle", val, { shouldValidate: true })}
              error={form.formState.errors.outfitStyle?.message}
            />

            <SelectField
              label="Composition / Framing"
              options={MARKETING_FORM_OPTIONS.composition}
              value={form.watch("composition")}
              onChange={(val) => form.setValue("composition", val, { shouldValidate: true })}
              error={form.formState.errors.composition?.message}
            />

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Additional Direction</Label>
              <Textarea
                placeholder="Any specific instructions — occasion, campaign theme, colour palette, mood..."
                {...form.register("customNotes")}
                rows={3}
              />
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                className="w-full"
                disabled={!uploadedFile || isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  "Generate Marketing Visual"
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center mt-2">
                All three AI models will generate simultaneously. This takes 20-40 seconds.
              </p>
            </div>
          </form>
        </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-7" ref={resultRef}>
          <div className="space-y-2 mb-6 lg:text-right">
            <h2 className="text-3xl font-serif text-foreground">Visual Output</h2>
            <p className="text-muted-foreground">
              Side-by-side AI interpretations of your marketing brief.
            </p>
          </div>

          {/* Empty state */}
          {!isLoading && !result && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-white border border-border/60 rounded-xl p-12 text-center"
            >
              <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <ImageIcon className="h-8 w-8 text-primary/50" />
              </div>
              <p className="font-serif text-lg text-foreground mb-2">
                Upload a jewellery image and select your styling preferences to generate a luxury marketing visual.
              </p>
              <p className="text-sm text-muted-foreground">
                Three AI interpretations will appear here, side by side.
              </p>
            </motion.div>
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { name: "Gemini", color: "bg-blue-100 text-blue-700" },
                { name: "OpenAI", color: "bg-green-100 text-green-700" },
                { name: "Grok", color: "bg-orange-100 text-orange-700" },
              ].map(({ name, color }) => (
                <div
                  key={name}
                  className="bg-white border border-border/60 rounded-xl overflow-hidden"
                >
                  <div className="p-3 border-b border-border/40">
                    <Badge
                      variant="secondary"
                      className={color}
                    >
                      {name}
                    </Badge>
                  </div>
                  <Skeleton className="w-full aspect-[3/4]" />
                  <div className="p-3 flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Generating...</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Results state */}
          {!isLoading && result && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Gemini result */}
                <ResultCard
                  model="Gemini"
                  badgeClass="bg-blue-100 text-blue-700"
                  imageUrl={result.gemini.imageUrl}
                  error={result.gemini.error}
                  onDownload={() =>
                    result.gemini.imageUrl && downloadImage(result.gemini.imageUrl, "gemini")
                  }
                />

                {/* OpenAI result */}
                <ResultCard
                  model="OpenAI"
                  badgeClass="bg-green-100 text-green-700"
                  imageUrl={result.openai.imageUrl}
                  error={result.openai.error}
                  onDownload={() =>
                    result.openai.imageUrl && downloadImage(result.openai.imageUrl, "openai")
                  }
                />

                {/* Grok result */}
                <ResultCard
                  model="Grok"
                  badgeClass="bg-orange-100 text-orange-700"
                  imageUrl={result.grok.imageUrl}
                  error={result.grok.error}
                  onDownload={() =>
                    result.grok.imageUrl && downloadImage(result.grok.imageUrl, "grok")
                  }
                />
              </div>

              {/* Prompt viewer + regenerate */}
              <Collapsible open={promptVisible} onOpenChange={setPromptVisible}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full justify-between">
                    View prompt used
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${promptVisible ? "rotate-180" : ""}`}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-2 p-4 bg-muted rounded-lg text-xs whitespace-pre-wrap font-mono max-h-[300px] overflow-auto">
                    {result.prompt}
                  </pre>
                </CollapsibleContent>
              </Collapsible>

              <FeedbackForm
                designProjectId={result.projectId}
                category={form.watch("jewelleryCategory") || "Necklace"}
                theme="Marketing"
              />

              <Button
                variant="outline"
                className="w-full"
                onClick={() => setResult(null)}
              >
                Generate Again
              </Button>
            </motion.div>
          )}
        </div>
      </div>
    </Layout>
  );
}

function ResultCard({
  model,
  badgeClass,
  imageUrl,
  error,
  onDownload,
}: {
  model: string;
  badgeClass: string;
  imageUrl: string | null;
  error: string | null;
  onDownload: () => void;
}) {
  const [fullPreview, setFullPreview] = useState(false);

  return (
    <div className="bg-white border border-border/60 rounded-xl overflow-hidden">
      <div className="p-3 border-b border-border/40">
        <Badge variant="secondary" className={badgeClass}>
          {model}
        </Badge>
      </div>

      {imageUrl ? (
        <>
          <div
            className="cursor-pointer relative group"
            onClick={() => setFullPreview(true)}
          >
            <img
              src={imageUrl}
              alt={`${model} marketing visual`}
              className="w-full h-auto object-contain bg-[#FDFBF7]"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
              <span className="text-white opacity-0 group-hover:opacity-100 text-xs font-medium bg-black/50 px-2 py-1 rounded">
                Click to enlarge
              </span>
            </div>
          </div>
          <div className="p-3">
            <Button size="sm" variant="outline" className="w-full" onClick={onDownload}>
              <Download className="mr-2 h-3 w-3" />
              Download
            </Button>
          </div>

          {/* Full-size preview modal */}
          {fullPreview && (
            <div
              className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
              onClick={() => setFullPreview(false)}
            >
              <img
                src={imageUrl}
                alt={`${model} marketing visual full size`}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}
        </>
      ) : (
        <div className="p-8 text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-3">
            <X className="h-5 w-5 text-destructive" />
          </div>
          <p className="text-sm font-medium text-destructive mb-1">{model} Failed</p>
          <p className="text-xs text-muted-foreground">
            {error || "This model was unable to generate a result for this request."}
          </p>
        </div>
      )}
    </div>
  );
}
