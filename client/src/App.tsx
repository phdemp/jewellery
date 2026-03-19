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
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
