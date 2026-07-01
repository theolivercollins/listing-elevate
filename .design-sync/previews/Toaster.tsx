import { Toast, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "reelready";

// Radix Toast.Root portals into a ToastViewport — without one it renders nothing.
// cardMode:single gives the fixed viewport a full card to anchor to.
export const Notification = () => (
  <div style={{ position: "relative", minHeight: 260, padding: 24, background: "var(--surface, #f4f4f5)" }}>
  <ToastProvider>
    <Toast open>
      <div style={{ display: "grid", gap: 4 }}>
        <ToastTitle>Video delivered</ToastTitle>
        <ToastDescription>&ldquo;123 Main St&rdquo; is ready to share.</ToastDescription>
      </div>
      <ToastClose />
    </Toast>
    <Toast open variant="destructive">
      <div style={{ display: "grid", gap: 4 }}>
        <ToastTitle>Render failed</ToastTitle>
        <ToastDescription>We&rsquo;ll retry automatically.</ToastDescription>
      </div>
      <ToastClose />
    </Toast>
    <ToastViewport />
  </ToastProvider>
  </div>
);
