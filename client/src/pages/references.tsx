import { useState, useEffect, useMemo } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Upload, 
  FolderOpen, 
  Loader2, 
  Trash2, 
  Image as ImageIcon,
  Database,
  Sparkles,
  Folder,
  RefreshCw
} from "lucide-react";
import { 
  getReferenceImages, 
  uploadReferenceImage, 
  deleteReferenceImage, 
  importFromDrive,
  reembedAllReferences,
  THEME_CODES,
  type ReferenceImage 
} from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

export default function References() {
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isDriveImporting, setIsDriveImporting] = useState(false);
  const [driveDialogOpen, setDriveDialogOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [driveFolderUrl, setDriveFolderUrl] = useState("");
  const [selectedTheme, setSelectedTheme] = useState<string>("all");
  const [uploadTheme, setUploadTheme] = useState<string>("");
  const [driveTheme, setDriveTheme] = useState<string>("");
  const [selectedReference, setSelectedReference] = useState<ReferenceImage | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isReembedding, setIsReembedding] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadReferences();
  }, []);

  const loadReferences = async () => {
    setIsLoading(true);
    try {
      const images = await getReferenceImages();
      setReferences(images);
    } catch (error: any) {
      toast({
        title: "Failed to load references",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const filteredReferences = useMemo(() => {
    if (selectedTheme === "all") return references;
    if (selectedTheme === "untagged") return references.filter(r => !r.themeCode);
    return references.filter(r => r.themeCode === selectedTheme);
  }, [references, selectedTheme]);

  const themeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: references.length, untagged: 0 };
    THEME_CODES.forEach(t => counts[t.code] = 0);
    references.forEach(r => {
      if (r.themeCode) {
        counts[r.themeCode] = (counts[r.themeCode] || 0) + 1;
      } else {
        counts.untagged++;
      }
    });
    return counts;
  }, [references]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    setPendingFiles(Array.from(files));
    setUploadDialogOpen(true);
    event.target.value = '';
  };

  const handleUploadConfirm = async () => {
    if (pendingFiles.length === 0) return;
    
    setIsUploading(true);
    let successCount = 0;
    let failCount = 0;

    for (const file of pendingFiles) {
      if (!file.type.startsWith('image/')) {
        failCount++;
        continue;
      }

      try {
        await uploadReferenceImage(file, uploadTheme || undefined);
        successCount++;
      } catch (error: any) {
        failCount++;
        console.error(`Failed to upload ${file.name}:`, error);
      }
    }

    if (successCount > 0) {
      await loadReferences();
    }
    
    toast({
      title: successCount > 0 ? "Upload Complete" : "Upload Failed",
      description: successCount > 0 
        ? `${successCount} image(s) uploaded to ${uploadTheme ? THEME_CODES.find(t => t.code === uploadTheme)?.name : 'library'}.${failCount > 0 ? ` ${failCount} failed.` : ''}`
        : "Failed to upload images.",
      variant: successCount > 0 ? "default" : "destructive",
    });

    setIsUploading(false);
    setUploadDialogOpen(false);
    setPendingFiles([]);
    setUploadTheme("");
  };

  const handleDriveImport = async () => {
    if (!driveFolderUrl.trim()) {
      toast({
        title: "Missing URL",
        description: "Please enter a Google Drive folder URL.",
        variant: "destructive",
      });
      return;
    }

    if (!driveTheme) {
      toast({
        title: "Missing Theme",
        description: "Please select a theme folder.",
        variant: "destructive",
      });
      return;
    }

    setIsDriveImporting(true);
    try {
      const result = await importFromDrive(driveFolderUrl, driveTheme);
      
      if (result.success > 0) {
        await loadReferences();
        toast({
          title: "Import Complete",
          description: `Successfully imported ${result.success} of ${result.total} images.`,
        });
      }
      
      if (result.failed > 0) {
        toast({
          title: "Some imports failed",
          description: `${result.failed} images could not be imported.`,
          variant: "destructive",
        });
      }
      
      setDriveDialogOpen(false);
      setDriveFolderUrl("");
      setDriveTheme("");
    } catch (error: any) {
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import from Google Drive.",
        variant: "destructive",
      });
    } finally {
      setIsDriveImporting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteReferenceImage(id);
      setReferences(references.filter(ref => ref.id !== id));
      setSelectedReference(null);
      toast({
        title: "Reference Deleted",
        description: "Reference image removed from library.",
      });
    } catch (error: any) {
      toast({
        title: "Delete Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const getThemeName = (code: string | undefined) => {
    if (!code) return "Untagged";
    return THEME_CODES.find(t => t.code === code)?.name || code;
  };

  const handleReembed = async () => {
    setIsReembedding(true);
    try {
      const result = await reembedAllReferences();
      toast({
        title: "Re-embedding Complete",
        description: `Successfully re-embedded ${result.success} of ${result.total} images with enhanced style metadata.`,
      });
      await loadReferences();
    } catch (error: any) {
      toast({
        title: "Re-embedding Failed",
        description: error.message || "Failed to re-embed reference images.",
        variant: "destructive",
      });
    } finally {
      setIsReembedding(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-3xl font-serif text-foreground">Reference Library</h2>
            <p className="text-muted-foreground mt-1">
              Organize your design references by theme folders for AI-powered similarity search.
            </p>
          </div>
          
          <div className="flex gap-3">
            <label htmlFor="file-upload">
              <Button 
                variant="outline" 
                className="gap-2 cursor-pointer" 
                disabled={isUploading || isDriveImporting}
                asChild
              >
                <span>
                  {isUploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  Upload Images
                </span>
              </Button>
              <input
                id="file-upload"
                type="file"
                accept="image/jpeg,image/png,image/jpg"
                multiple
                className="hidden"
                onChange={handleFileSelect}
                disabled={isUploading || isDriveImporting}
                data-testid="input-file-upload"
              />
            </label>

            <Dialog open={driveDialogOpen} onOpenChange={setDriveDialogOpen}>
              <DialogTrigger asChild>
                <Button 
                  className="gap-2" 
                  disabled={isUploading || isDriveImporting}
                  data-testid="button-import-drive"
                >
                  <FolderOpen className="w-4 h-4" />
                  Import from Drive
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Import from Google Drive</DialogTitle>
                  <DialogDescription>
                    Paste the link to a Google Drive folder. All images will be downloaded, analyzed by AI, and added to your reference library.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <Input
                    placeholder="https://drive.google.com/drive/folders/..."
                    value={driveFolderUrl}
                    onChange={(e) => setDriveFolderUrl(e.target.value)}
                    disabled={isDriveImporting}
                    data-testid="input-drive-url"
                  />
                  <Select value={driveTheme} onValueChange={setDriveTheme} disabled={isDriveImporting}>
                    <SelectTrigger data-testid="select-drive-theme">
                      <SelectValue placeholder="Select theme folder..." />
                    </SelectTrigger>
                    <SelectContent>
                      {THEME_CODES.map((theme) => (
                        <SelectItem key={theme.code} value={theme.code}>
                          <span className="flex items-center gap-2">
                            <Folder className="w-4 h-4" />
                            <span className="font-medium">{theme.code}</span>
                            <span className="text-muted-foreground">- {theme.name}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isDriveImporting && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Importing and analyzing images... This may take several minutes.</span>
                    </div>
                  )}
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setDriveDialogOpen(false)}
                    disabled={isDriveImporting}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleDriveImport}
                    disabled={isDriveImporting || !driveFolderUrl.trim() || !driveTheme}
                    data-testid="button-start-import"
                  >
                    {isDriveImporting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      "Start Import"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button
              variant="outline"
              className="gap-2"
              onClick={handleReembed}
              disabled={isUploading || isDriveImporting || isReembedding || references.length === 0}
              data-testid="button-reembed-all"
            >
              {isReembedding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Re-embed All
            </Button>
          </div>
        </div>

        {/* Upload Theme Selection Dialog */}
        <Dialog open={uploadDialogOpen} onOpenChange={(open) => {
          if (!open) {
            setPendingFiles([]);
            setUploadTheme("");
          }
          setUploadDialogOpen(open);
        }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Select Theme Folder</DialogTitle>
              <DialogDescription>
                Choose a theme folder for {pendingFiles.length} image(s). This helps organize references for better AI matching.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Select value={uploadTheme} onValueChange={setUploadTheme}>
                <SelectTrigger data-testid="select-upload-theme">
                  <SelectValue placeholder="Select a theme folder..." />
                </SelectTrigger>
                <SelectContent>
                  {THEME_CODES.map((theme) => (
                    <SelectItem key={theme.code} value={theme.code}>
                      <span className="flex items-center gap-2">
                        <Folder className="w-4 h-4" />
                        <span className="font-medium">{theme.code}</span>
                        <span className="text-muted-foreground">- {theme.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setUploadDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUploadConfirm}
                disabled={isUploading || !uploadTheme}
                data-testid="button-confirm-upload"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Upload to {uploadTheme || "folder"}
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-white/60 backdrop-blur-sm border-border/60">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <Database className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-serif font-semibold">{references.length}</p>
                  <p className="text-sm text-muted-foreground">Total References</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-white/60 backdrop-blur-sm border-border/60">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-secondary/30 rounded-full flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-secondary-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-serif font-semibold">{THEME_CODES.filter(t => themeCounts[t.code] > 0).length}</p>
                  <p className="text-sm text-muted-foreground">Active Themes</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="md:col-span-2 bg-white/60 backdrop-blur-sm border-border/60">
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">
                References are organized by theme folders. When generating a design, the AI searches for similar references 
                within the selected theme folder to inform the design style.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Theme Tabs */}
        <Tabs value={selectedTheme} onValueChange={setSelectedTheme} className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1 bg-white/60 p-2 border border-border/40">
            <TabsTrigger value="all" className="gap-1 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              All <Badge variant="secondary" className="ml-1">{themeCounts.all}</Badge>
            </TabsTrigger>
            {THEME_CODES.map((theme) => (
              <TabsTrigger 
                key={theme.code} 
                value={theme.code}
                className="gap-1 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                {theme.code} <Badge variant="secondary" className="ml-1">{themeCounts[theme.code] || 0}</Badge>
              </TabsTrigger>
            ))}
            <TabsTrigger value="untagged" className="gap-1 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Untagged <Badge variant="secondary" className="ml-1">{themeCounts.untagged}</Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value={selectedTheme} className="mt-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filteredReferences.length === 0 ? (
              <Card className="bg-white/60 backdrop-blur-sm border-border/60">
                <CardContent className="py-20 text-center">
                  <Folder className="w-12 h-12 text-muted-foreground/50 mx-auto mb-4" />
                  <h3 className="text-lg font-serif text-foreground mb-2">
                    {selectedTheme === "all" ? "No References Yet" : `No ${getThemeName(selectedTheme)} References`}
                  </h3>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    {selectedTheme === "all" 
                      ? "Upload your jewellery design sketches to build your AI reference library."
                      : `Upload images to the ${getThemeName(selectedTheme)} folder to populate this theme.`
                    }
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {filteredReferences.map((ref) => (
                  <Card 
                    key={ref.id} 
                    className="bg-white/60 backdrop-blur-sm border-border/60 overflow-hidden cursor-pointer hover:shadow-md transition-shadow hover:scale-[1.02] transition-transform duration-200 group"
                    onClick={() => setSelectedReference(ref)}
                    data-testid={`reference-card-${ref.id}`}
                  >
                    <div className="aspect-square bg-muted/30 flex items-center justify-center relative overflow-hidden">
                      {(ref.thumbnailUrl || ref.imageUrl) ? (
                        <img 
                          src={ref.thumbnailUrl || ref.imageUrl} 
                          alt={ref.filename}
                          loading="lazy"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <ImageIcon className="w-8 h-8 text-muted-foreground/30" />
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
                      {ref.themeCode && (
                        <Badge 
                          className="absolute top-2 right-2 bg-white/90 text-foreground text-xs"
                          variant="secondary"
                        >
                          {ref.themeCode}
                        </Badge>
                      )}
                    </div>
                    <CardContent className="p-3">
                      <p className="text-sm font-medium truncate">{ref.filename}</p>
                      <p className="text-xs text-muted-foreground truncate mt-1">
                        {ref.analysis?.motifs?.slice(0, 2).join(', ') || 'Analyzed'}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Reference Detail Dialog */}
        <Dialog open={!!selectedReference} onOpenChange={() => setSelectedReference(null)}>
          <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
            {selectedReference && (
              <>
                <DialogHeader>
                  <DialogTitle className="font-serif flex items-center gap-2">
                    {selectedReference.filename}
                    {selectedReference.themeCode && (
                      <Badge variant="outline">{selectedReference.themeCode}</Badge>
                    )}
                  </DialogTitle>
                  <DialogDescription>
                    AI-analyzed design reference • {getThemeName(selectedReference.themeCode)}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  {selectedReference.imageUrl && (
                    <div className="aspect-video bg-muted/30 rounded-lg overflow-hidden">
                      <img 
                        src={selectedReference.imageUrl} 
                        alt={selectedReference.filename}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  )}
                  <div>
                    <h4 className="text-sm font-medium mb-2">Description</h4>
                    <p className="text-sm text-muted-foreground">
                      {selectedReference.analysis?.description || 'No description available'}
                    </p>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium mb-2">Motifs Detected</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedReference.analysis?.motifs?.map((motif, idx) => (
                        <span 
                          key={idx}
                          className="px-2 py-1 bg-secondary/30 rounded-full text-xs"
                        >
                          {motif}
                        </span>
                      )) || <span className="text-sm text-muted-foreground">None detected</span>}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium mb-2">Style Elements</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedReference.analysis?.styleElements?.map((style, idx) => (
                        <span 
                          key={idx}
                          className="px-2 py-1 bg-accent/30 rounded-full text-xs"
                        >
                          {style}
                        </span>
                      )) || <span className="text-sm text-muted-foreground">None detected</span>}
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="text-sm font-medium mb-2">Structure</h4>
                    <p className="text-sm text-muted-foreground">
                      {selectedReference.analysis?.structure || 'No structure analysis available'}
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="destructive"
                    onClick={() => handleDelete(selectedReference.id)}
                    className="gap-2"
                    data-testid="button-delete-reference"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Reference
                  </Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
