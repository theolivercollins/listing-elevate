import { Toaster as SonnerToaster } from "reelready";

export const Host = () => (
  <div style={{ padding: 24 }}>
    <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
      Sonner toast host (renders toasts imperatively via <code>toast()</code>; e.g. &ldquo;Video delivered&rdquo; on
      render completion). No static open state to preview here.
    </div>
    <SonnerToaster />
  </div>
);
