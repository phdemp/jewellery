import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { OrnamentalDivider } from "@/components/ornamental-divider";
import { createFeedback } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { MessageSquarePlus, ThumbsUp, AlertTriangle, Loader2 } from "lucide-react";

const FEEDBACK_TAGS = [
  "stones",
  "motifs",
  "proportions",
  "style",
  "layout",
  "overall",
] as const;

interface FeedbackFormProps {
  designProjectId?: string | null;
  category: string;
  theme: string;
}

export function FeedbackForm({ designProjectId, category, theme }: FeedbackFormProps) {
  const [feedbackText, setFeedbackText] = useState("");
  const [sentiment, setSentiment] = useState<"positive" | "corrective">("corrective");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async () => {
    if (!feedbackText.trim()) {
      toast({
        title: "Feedback required",
        description: "Please enter your feedback text before submitting.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await createFeedback({
        feedbackText: feedbackText.trim(),
        category: category || "General",
        theme: theme || "Modern",
        tags: selectedTags,
        sentiment,
        designProjectId: designProjectId || undefined,
      });

      toast({
        title: "Feedback saved",
        description: "Your feedback will improve future generations. Thank you!",
      });

      // Reset form
      setFeedbackText("");
      setSelectedTags([]);
      setSentiment("corrective");
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to save feedback";
      toast({
        title: "Error",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mt-6">
      <OrnamentalDivider className="mb-4" />
      <div className="rounded-xl border border-amber-200/40 bg-white/60 p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <MessageSquarePlus className="h-5 w-5 text-amber-600/70" />
          <h3 className="text-lg font-serif text-foreground">Design Feedback</h3>
        </div>
        <p className="text-sm text-muted-foreground -mt-2">
          Help the AI learn your preferences. Your feedback shapes future generations.
        </p>

        {/* Sentiment Picker */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSentiment("positive")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
              sentiment === "positive"
                ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                : "border-border text-muted-foreground hover:bg-secondary/40"
            )}
          >
            <ThumbsUp className="h-3.5 w-3.5" />
            Positive
          </button>
          <button
            type="button"
            onClick={() => setSentiment("corrective")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
              sentiment === "corrective"
                ? "bg-amber-50 text-amber-700 border-amber-300"
                : "border-border text-muted-foreground hover:bg-secondary/40"
            )}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Corrective
          </button>
        </div>

        {/* Tag Multi-Select */}
        <div>
          <p className="text-sm font-medium text-foreground mb-2">Tags</p>
          <div className="flex flex-wrap gap-2">
            {FEEDBACK_TAGS.map((tag) => (
              <Badge
                key={tag}
                variant={selectedTags.includes(tag) ? "default" : "outline"}
                className={cn(
                  "cursor-pointer capitalize transition-colors",
                  selectedTags.includes(tag)
                    ? "bg-amber-600 hover:bg-amber-700 text-white"
                    : "hover:bg-amber-50 hover:text-amber-700 hover:border-amber-300"
                )}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>

        {/* Feedback Text */}
        <Textarea
          placeholder={
            sentiment === "positive"
              ? "What do you like about this design? (e.g., 'The polki placement is perfect')"
              : "What should be improved? (e.g., 'Too many stones, needs more gold visibility')"
          }
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          rows={3}
          className="resize-none border-amber-200/60 focus:border-amber-400"
        />

        {/* Submit Button */}
        <div className="flex justify-end">
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !feedbackText.trim()}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Submit Feedback"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
