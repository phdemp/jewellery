import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { OrnamentalDivider } from "@/components/ornamental-divider";

function RaniwalaLogo() {
  return (
    <div className="flex flex-col items-center leading-none select-none">
      <span className="font-serif text-base font-semibold tracking-[0.25em] text-primary uppercase">
        Raniwala
      </span>
      <div className="flex items-center gap-1.5 w-full">
        <div className="h-px flex-1 bg-primary/40" />
        <span className="font-serif text-[10px] font-light tracking-[0.3em] text-primary/80">
          1881
        </span>
        <div className="h-px flex-1 bg-primary/40" />
      </div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen flex flex-col font-sans bg-background text-foreground relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-0 left-0 w-full h-24 bg-gradient-to-b from-white to-transparent opacity-80 z-10 pointer-events-none" />
      <div className="fixed -top-[20%] -right-[10%] w-[50vw] h-[50vw] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="fixed top-[40%] -left-[10%] w-[30vw] h-[30vw] bg-secondary/20 rounded-full blur-[80px] pointer-events-none" />

      <header className={cn(
        "sticky top-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-background/95 backdrop-blur-sm border-b border-primary/15 shadow-sm"
          : "bg-background/70 backdrop-blur-sm"
      )}>
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/">
            <div className="cursor-pointer">
              <RaniwalaLogo />
            </div>
          </Link>
          <nav className="flex items-center gap-6 text-sm font-medium">
            <Link href="/">
              <span
                className={`cursor-pointer transition-colors ${location === "/" ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                data-testid="nav-design-studio"
              >
                Design Studio
              </span>
            </Link>
            <Link href="/references">
              <span
                className={`cursor-pointer transition-colors ${location === "/references" ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                data-testid="nav-references"
              >
                Reference Library
              </span>
            </Link>
            <Link href="/modify">
              <span
                className={`cursor-pointer transition-colors ${location === "/modify" ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                data-testid="nav-modify"
              >
                Design Modifier
              </span>
            </Link>
            <Link href="/cad-comparison">
              <span
                className={`cursor-pointer transition-colors ${location === "/cad-comparison" ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                data-testid="nav-cad-comparison"
              >
                CAD Comparison
              </span>
            </Link>
            <Link href="/marketing">
              <span
                className={`cursor-pointer transition-colors ${location === "/marketing" ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                data-testid="nav-marketing"
              >
                Marketing Visuals
              </span>
            </Link>
            <Link href="/assortment">
              <span
                className={`cursor-pointer transition-colors ${location === "/assortment" ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                data-testid="nav-assortment"
              >
                Intelligence Platform
              </span>
            </Link>
            <Link href="/quality">
              <span
                className={`cursor-pointer transition-colors ${location === "/quality" ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                data-testid="nav-quality"
              >
                Quality
              </span>
            </Link>
            <Link href="/feedback">
              <span
                className={`cursor-pointer transition-colors ${location === "/feedback" ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                data-testid="nav-feedback"
              >
                Feedback
              </span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8 relative z-0">
        {children}
      </main>

      <footer>
        <OrnamentalDivider />
        <div className="py-6 text-center">
          <p className="font-serif text-sm text-muted-foreground tracking-wide">
            © 2025 Raniwala 1881
          </p>
          <p className="font-serif text-xs text-muted-foreground/60 italic mt-0.5 tracking-wide">
            Design to Inspire, Legacy to Celebrate
          </p>
        </div>
      </footer>
    </div>
  );
}
