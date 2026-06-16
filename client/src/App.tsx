import * as Sentry from "@sentry/react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fetchAuthStatus } from "@/lib/api";
import Login from "@/pages/login";
import Home from "@/pages/home";
import References from "@/pages/references";
import Comparison from "@/pages/comparison";
import ModifyPage from "@/pages/modify";
import CadComparison from "@/pages/cad-comparison";
import MarketingPage from "@/pages/marketing";
import IntelligencePage from "@/pages/intelligence";
import FeedbackPage from "@/pages/feedback";
import QualityPage from "@/pages/quality";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/references" component={References} />
      <Route path="/comparison" component={Comparison} />
      <Route path="/modify" component={ModifyPage} />
      <Route path="/cad-comparison" component={CadComparison} />
      <Route path="/marketing" component={MarketingPage} />
      <Route path="/assortment" component={IntelligencePage} />
      <Route path="/feedback" component={FeedbackPage} />
      <Route path="/quality" component={QualityPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthGate() {
  const { data, isLoading } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: fetchAuthStatus,
    staleTime: Infinity,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!data?.authenticated) {
    return <Login />;
  }

  return <Router />;
}

function ErrorFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2">Something went wrong</h1>
        <p className="text-muted-foreground mb-4">An unexpected error occurred.</p>
        <button onClick={() => window.location.reload()} className="underline">
          Reload page
        </button>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
          <AuthGate />
        </Sentry.ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
