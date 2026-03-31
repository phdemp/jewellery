import { motion } from "framer-motion";
import { Download, X, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ModelResult } from "@/lib/api";
import { useState, useEffect, useCallback } from "react";

interface MultiModelResultProps {
  gemini?: ModelResult;
  openai?: ModelResult;
  grok?: ModelResult;
}

const MODEL_CONFIG = [
  { key: "gemini" as const, label: "Gemini", badgeClass: "bg-blue-100 text-blue-700" },
  { key: "openai" as const, label: "OpenAI", badgeClass: "bg-purple-100 text-purple-700" },
  { key: "grok" as const, label: "Grok", badgeClass: "bg-orange-100 text-orange-700" },
];

export function MultiModelResult({ gemini, openai, grok }: MultiModelResultProps) {
  const results = { gemini, openai, grok };

  if (!gemini && !openai && !grok) return null;

  return (
    <div className="space-y-3">
      <h3 className="font-serif text-lg text-muted-foreground">Model Comparison</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {MODEL_CONFIG.map((config, i) => {
          const result = results[config.key];
          if (!result) return null;
          return (
            <ModelCard
              key={config.key}
              label={config.label}
              badgeClass={config.badgeClass}
              result={result}
              delay={i * 0.1}
            />
          );
        })}
      </div>
    </div>
  );
}

function ModelCard({
  label,
  badgeClass,
  result,
  delay,
}: {
  label: string;
  badgeClass: string;
  result: ModelResult;
  delay: number;
}) {
  const [fullPreview, setFullPreview] = useState(false);

  const closePreview = useCallback(() => setFullPreview(false), []);

  useEffect(() => {
    if (!fullPreview) return;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullPreview, closePreview]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-white border border-border/60 rounded-xl overflow-hidden"
    >
      <div className="p-3 border-b border-border/40 flex items-center justify-between">
        <Badge variant="secondary" className={badgeClass}>
          {label}
        </Badge>
        {result.model && (
          <span className="text-[10px] text-muted-foreground truncate ml-2">
            {result.model}
          </span>
        )}
      </div>

      {result.imageUrl ? (
        <>
          <div
            className="cursor-pointer relative group bg-[#FDFBF7]"
            onClick={() => setFullPreview(true)}
          >
            <img
              src={result.imageUrl}
              alt={`${label} output`}
              className="w-full h-auto object-contain"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
              <span className="text-white opacity-0 group-hover:opacity-100 text-xs font-medium bg-black/50 px-2 py-1 rounded">
                Click to enlarge
              </span>
            </div>
          </div>
          <div className="p-2 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1 h-8 text-xs"
              onClick={() => {
                const a = document.createElement("a");
                a.href = result.imageUrl!;
                a.download = `raniwala-${label.toLowerCase()}-${Date.now()}.png`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }}
            >
              <Download className="mr-1 h-3 w-3" />
              Download
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => window.open(result.imageUrl!, "_blank")}
            >
              <Maximize2 className="h-3 w-3" />
            </Button>
          </div>

          {fullPreview && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label={`${label} full size preview`}
              className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
              onClick={closePreview}
            >
              <img
                src={result.imageUrl}
                alt={`${label} full size`}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}
        </>
      ) : (
        <div className="p-6 text-center">
          <div className="mx-auto w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center mb-2">
            <X className="h-4 w-4 text-destructive" />
          </div>
          <p className="text-sm font-medium text-destructive mb-1">{label} Failed</p>
          <p className="text-xs text-muted-foreground">
            {result.error || "This model was unable to generate a result."}
          </p>
        </div>
      )}
    </motion.div>
  );
}
