import "@fontsource/inter";
import { BrowserRouter, MemoryRouter, Routes, Route } from "react-router-dom";
import { lazy, Suspense } from "react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { ToastProvider } from "@/shared/ui-components/toast";

// Lazy load components
const SchemaVisualizer = lazy(() =>
  import("../visualizer/3d/components/schema-visualizer").then((m) => ({
    default: m.SchemaVisualizer,
  }))
);
const About = lazy(() => import("../pages/about"));
const NotFound = lazy(() => import("../pages/not-found"));

// The standalone single-file build runs from file://, where the URL path is
// the local file path — BrowserRouter would match the 404 route and history
// pushes are not allowed. Route in memory instead; the schema share-hash is
// read directly from window.location and is unaffected.
const Router =
  window.location.protocol === "file:" ? MemoryRouter : BrowserRouter;

function App() {
  return (
    <Router>
      <div
        style={{
          width: "100vw",
          height: "100vh",
          position: "relative",
          overflow: "hidden",
          /* Use full viewport including safe areas - app extends to edges */
          minHeight: "-webkit-fill-available",
        }}
      >
        <Suspense
          fallback={
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100vh",
                background: "#0f172a",
                color: "#fff",
              }}
            >
              Loading...
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<SchemaVisualizer />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        <Analytics />
        <SpeedInsights />
        <ToastProvider />
      </div>
    </Router>
  );
}

export default App;
