import { useState } from "react";
import { getFaqs } from "@/v2/data/faqs";
import { LEIcon } from "@/v2/components/primitives/LEIcon";

export function FAQ() {
  const faqs = getFaqs();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section
      id="faq"
      style={{ background: "transparent", color: "var(--le-text)", padding: "140px 48px" }}
    >
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <div className="le-eyebrow" style={{ marginBottom: 24 }}>— FAQ</div>
        <h2
          className="le-display"
          style={{
            fontSize: "clamp(44px, 5.5vw, 76px)",
            lineHeight: 0.98,
            margin: "0 0 64px",
            color: "var(--le-text)",
          }}
        >
          Questions, briefly.
        </h2>
        <div>
          {faqs.map((f) => {
            const isOpen = open === f.id;
            return (
              <div
                key={f.id}
                style={{ borderBottom: "1px solid var(--le-border)" }}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : f.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "24px 0",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--le-text)",
                    textAlign: "left",
                    gap: 16,
                  }}
                >
                  <span
                    style={{
                      fontSize: 20,
                      fontWeight: 500,
                      letterSpacing: "-0.02em",
                      fontFamily: "var(--le-font-sans)",
                    }}
                  >
                    {f.question}
                  </span>
                  <LEIcon
                    name={isOpen ? "minus" : "plus"}
                    size={16}
                    color="var(--le-text-faint)"
                  />
                </button>
                {isOpen && (
                  <div
                    style={{
                      paddingBottom: 28,
                      fontSize: 15,
                      color: "var(--le-text-muted)",
                      lineHeight: 1.65,
                      fontFamily: "var(--le-font-sans)",
                      maxWidth: 720,
                    }}
                  >
                    {f.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
