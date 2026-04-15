import { useState, useEffect, useCallback } from "react";
import { Layout } from "@/components/layout";
import { OrnamentalDivider } from "@/components/ornamental-divider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Pencil,
  Trash2,
  Save,
  X,
  MessageSquare,
  Filter,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { CATEGORIES } from "@/lib/jewellery-logic";
import {
  getFeedbackList,
  updateFeedback,
  deleteFeedback,
  type DesignFeedbackEntry,
  type FeedbackListResponse,
} from "@/lib/api";

const THEME_CODE_LIST = [
  "WRD", "WRO", "CLO", "SOD", "SOO", "SOP", "BRC", "BRP", "BRU",
  "Marketing", "Modern", "CAD",
];

const ITEMS_PER_PAGE = 10;

const COMMON_TAGS = [
  "polki", "motif", "proportion", "symmetry", "layout",
  "stones", "gold", "texture", "style", "shape",
];

export default function FeedbackPage() {
  const [data, setData] = useState<FeedbackListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterTheme, setFilterTheme] = useState<string>("all");
  const [filterSentiment, setFilterSentiment] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editSentiment, setEditSentiment] = useState<"positive" | "corrective">("positive");
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const loadFeedback = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: { page: number; limit: number; category?: string; theme?: string } = {
        page,
        limit: ITEMS_PER_PAGE,
      };
      if (filterCategory !== "all") params.category = filterCategory;
      if (filterTheme !== "all") params.theme = filterTheme;

      const result = await getFeedbackList(params);

      // Client-side sentiment filter (API doesn't support it)
      if (filterSentiment !== "all") {
        result.data = result.data.filter((f) => f.sentiment === filterSentiment);
      }

      setData(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({
        title: "Failed to load feedback",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [page, filterCategory, filterTheme, filterSentiment, toast]);

  useEffect(() => {
    loadFeedback();
  }, [loadFeedback]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [filterCategory, filterTheme, filterSentiment]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / ITEMS_PER_PAGE)) : 1;

  const startEdit = (entry: DesignFeedbackEntry) => {
    setEditingId(entry.id);
    setEditText(entry.feedbackText);
    setEditTags([...entry.tags]);
    setEditSentiment(entry.sentiment as "positive" | "corrective");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
    setEditTags([]);
  };

  const handleSave = async (id: string) => {
    setIsSaving(true);
    try {
      await updateFeedback(id, {
        feedbackText: editText,
        tags: editTags,
        sentiment: editSentiment,
      });
      toast({ title: "Feedback updated", description: "Changes saved successfully." });
      setEditingId(null);
      await loadFeedback();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = window.confirm("Are you sure you want to delete this feedback entry? This action cannot be undone.");
    if (!confirmed) return;

    try {
      await deleteFeedback(id);
      toast({ title: "Feedback deleted", description: "Entry removed from library." });
      await loadFeedback();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast({ title: "Delete failed", description: message, variant: "destructive" });
    }
  };

  const toggleTag = (tag: string) => {
    setEditTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Hero */}
        <div className="text-center space-y-3">
          <h2 className="text-3xl font-serif text-foreground">Feedback Library</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Browse, filter, and manage all designer feedback. Each entry shapes future AI generations through prompt learning.
          </p>
          <OrnamentalDivider />
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center gap-4 bg-white/60 backdrop-blur-sm border border-amber-200/40 rounded-xl p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="w-4 h-4" />
            <span className="font-medium">Filters</span>
          </div>

          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterTheme} onValueChange={setFilterTheme}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Theme" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Themes</SelectItem>
              {THEME_CODE_LIST.map((code) => (
                <SelectItem key={code} value={code}>{code}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1">
            {(["all", "positive", "corrective"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilterSentiment(s)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors capitalize",
                  filterSentiment === s
                    ? s === "positive"
                      ? "bg-emerald-100 border-emerald-300 text-emerald-800"
                      : s === "corrective"
                        ? "bg-amber-100 border-amber-300 text-amber-800"
                        : "bg-primary text-primary-foreground border-primary"
                    : "bg-white/60 border-border/40 text-muted-foreground hover:border-primary/40"
                )}
              >
                {s === "all" ? "All" : s}
              </button>
            ))}
          </div>

          {data && (
            <span className="ml-auto text-sm text-muted-foreground">
              {data.total} {data.total === 1 ? "entry" : "entries"}
            </span>
          )}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : !data || data.data.length === 0 ? (
          <div className="bg-white/60 backdrop-blur-sm border border-amber-200/40 rounded-xl py-20 text-center">
            <MessageSquare className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
            <h3 className="text-lg font-serif text-foreground mb-2">No Feedback Found</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              {filterCategory !== "all" || filterTheme !== "all" || filterSentiment !== "all"
                ? "No feedback matches the selected filters. Try adjusting your criteria."
                : "No feedback entries yet. Generate designs and submit feedback to start building your prompt learning library."}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {data.data.map((entry) => {
              const isEditing = editingId === entry.id;

              return (
                <div
                  key={entry.id}
                  className="bg-white/60 backdrop-blur-sm border border-amber-200/40 rounded-xl p-5 space-y-3 transition-shadow hover:shadow-sm"
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        className={cn(
                          "text-xs",
                          entry.sentiment === "positive"
                            ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                            : "bg-amber-100 text-amber-800 border-amber-200"
                        )}
                        variant="outline"
                      >
                        {entry.sentiment}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{entry.category}</span>
                      <span className="text-xs text-muted-foreground/60">|</span>
                      <span className="text-xs text-muted-foreground">{entry.theme}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {isEditing ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleSave(entry.id)}
                            disabled={isSaving}
                            className="h-8 w-8 p-0"
                          >
                            {isSaving ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Save className="w-4 h-4 text-emerald-600" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={cancelEdit}
                            disabled={isSaving}
                            className="h-8 w-8 p-0"
                          >
                            <X className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEdit(entry)}
                            className="h-8 w-8 p-0"
                          >
                            <Pencil className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(entry.id)}
                            className="h-8 w-8 p-0"
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Body */}
                  {isEditing ? (
                    <div className="space-y-3">
                      <Textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={3}
                        className="resize-none"
                      />

                      {/* Sentiment toggle */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Sentiment:</span>
                        {(["positive", "corrective"] as const).map((s) => (
                          <button
                            key={s}
                            onClick={() => setEditSentiment(s)}
                            className={cn(
                              "px-3 py-1 rounded-full text-xs font-medium border transition-colors capitalize",
                              editSentiment === s
                                ? s === "positive"
                                  ? "bg-emerald-100 border-emerald-300 text-emerald-800"
                                  : "bg-amber-100 border-amber-300 text-amber-800"
                                : "bg-white/60 border-border/40 text-muted-foreground"
                            )}
                          >
                            {s}
                          </button>
                        ))}
                      </div>

                      {/* Tag toggles */}
                      <div className="flex flex-wrap gap-1.5">
                        {COMMON_TAGS.map((tag) => (
                          <button
                            key={tag}
                            onClick={() => toggleTag(tag)}
                            className={cn(
                              "px-2.5 py-0.5 rounded-full text-xs border transition-colors",
                              editTags.includes(tag)
                                ? "bg-primary/10 border-primary/30 text-primary"
                                : "bg-white/60 border-border/40 text-muted-foreground"
                            )}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-foreground leading-relaxed">{entry.feedbackText}</p>
                      {entry.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {entry.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {/* Footer */}
                  <div className="text-xs text-muted-foreground/60">
                    {formatDate(entry.createdAt)}
                    {entry.designProjectId && (
                      <span className="ml-2">
                        Project: {entry.designProjectId.slice(0, 8)}...
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {data && data.total > ITEMS_PER_PAGE && (
          <div className="flex items-center justify-center gap-4 pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="gap-1"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="gap-1"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </Layout>
  );
}
