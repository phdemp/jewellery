import * as Sentry from "@sentry/react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Home from "@/pages/home";
import References from "@/pages/references";
import Comparison from "@/pages/comparison";
import ModifyPage from "@/pages/modify";
import CadComparison from "@/pages/cad-comparison";
import MarketingPage from "@/pages/marketing";
import AssortmentPage from "@/pages/assortment";
import FeedbackPage from "@/pages/feedback";
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
      <Route path="/assortment" component={AssortmentPage} />
      <Route path="/feedback" component={FeedbackPage} />
      <Route component={NotFound} />
    </Switch>
  );
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
          <Router />
        </Sentry.ErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
