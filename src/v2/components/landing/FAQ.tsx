import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getFaqs } from "@/v2/data/faqs";
import { Reveal } from "@/v2/components/primitives/Reveal";
import { Section } from "@/v2/components/landing/Section";

const EASE = [0.22, 1, 0.36, 1] as const;

export function FAQ() {
  const faqs = getFaqs();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Section
      id="faq"
      eyebrow="— FAQ"
      title="Questions, briefly."
      maxWidth={1200}
      tint
      ambient="softer"
    >
      {/* Constrain question list to 760px left-aligned so left edge holds */}
      <div style={{ maxWidth: 760 }}>
        {faqs.map((f) => {
          const isOpen = open === f.id;
          return (
            <div key={f.id} style={{ borderBottom: "1px solid var(--le-border)" }}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : f.id)}
                className="le-faq-toggle"
                aria-expanded={isOpen}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "24px 0",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  gap: 16,
                }}
              >
                <span
                  style={{
                    fontSize: "clamp(16px, 4vw, 20px)",
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                    fontFamily: "var(--le-font-sans)",
                  }}
                >
                  {f.question}
                </span>
                {/* Rotate plus 45° → becomes × when open */}
                <span
                  aria-hidden
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    width: 16,
                    height: 16,
                    transform: isOpen ? "rotate(45deg)" : "rotate(0deg)",
                    transition: "transform 200ms ease",
                    color: "var(--le-text-faint)",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <line
                      x1="7"
                      y1="1"
                      x2="7"
                      y2="13"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <line
                      x1="1"
                      y1="7"
                      x2="13"
                      y2="7"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key="answer"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    style={{ overflow: "hidden" }}
                  >
                    <div
                      style={{
                        paddingBottom: 28,
                        fontSize: 15,
                        color: "var(--le-text-muted)",
                        lineHeight: 1.65,
                        fontFamily: "var(--le-font-sans)",
                      }}
                    >
                      {f.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
