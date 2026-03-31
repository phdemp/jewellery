import { cn } from "@/lib/utils";

export function OrnamentalDivider({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center py-4 opacity-50", className)}>
      <svg viewBox="0 0 300 24" className="w-64 h-6 text-amber-500/70" fill="currentColor">
        {/* Left line */}
        <line x1="0" y1="12" x2="110" y2="12" stroke="currentColor" strokeWidth="0.8" />
        {/* Left flourish curves */}
        <path d="M110,12 Q120,4 130,12 Q120,20 110,12Z" />
        {/* Center diamond */}
        <polygon points="150,4 158,12 150,20 142,12" />
        {/* Right flourish curves */}
        <path d="M190,12 Q180,4 170,12 Q180,20 190,12Z" />
        {/* Right line */}
        <line x1="190" y1="12" x2="300" y2="12" stroke="currentColor" strokeWidth="0.8" />
        {/* Small dots */}
        <circle cx="140" cy="12" r="2" />
        <circle cx="160" cy="12" r="2" />
      </svg>
    </div>
  );
}
