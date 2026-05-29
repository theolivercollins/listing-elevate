import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/studio-design.css";

const root = createRoot(document.getElementById("root")!);

if (window.location.pathname === "/custom-pricing") {
  import("./pages/Pricing.tsx").then(({ default: Pricing }) => {
    root.render(<Pricing />);
  });
} else {
  import("./App.tsx").then(({ default: App }) => {
    root.render(<App />);
  });
}
