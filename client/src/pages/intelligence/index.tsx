import { IntelligenceProvider, useIntelligence } from "./intelligence-context";
import { IntelligenceLayout } from "./intelligence-layout";
import DashboardPage from "./pages/dashboard";
import InventoryPage from "./pages/inventory";
import SkuIntelPage from "./pages/sku-intel";
import SalesPage from "./pages/sales";
import ClientsPage from "./pages/clients";
import AssortmentPage from "./pages/assortment";
import CataloguePage from "./pages/catalogue";
import DispatchPage from "./pages/dispatch";
import LonePiecesPage from "./pages/lone-pieces";
import RecommendationsPage from "./pages/recommendations";
import ReportsPage from "./pages/reports";

function IntelligenceContent() {
  const { activePage } = useIntelligence();

  switch (activePage) {
    case "dashboard":
      return <DashboardPage />;
    case "inventory":
      return <InventoryPage />;
    case "skuintel":
      return <SkuIntelPage />;
    case "sales":
      return <SalesPage />;
    case "clients":
      return <ClientsPage />;
    case "assortment":
      return <AssortmentPage />;
    case "catalogue":
      return <CataloguePage />;
    case "dispatch":
      return <DispatchPage />;
    case "lonepieces":
      return <LonePiecesPage />;
    case "recommendations":
      return <RecommendationsPage />;
    case "reports":
      return <ReportsPage />;
    default:
      return <DashboardPage />;
  }
}

export default function IntelligencePage() {
  return (
    <IntelligenceProvider>
      <IntelligenceLayout>
        <IntelligenceContent />
      </IntelligenceLayout>
    </IntelligenceProvider>
  );
}
