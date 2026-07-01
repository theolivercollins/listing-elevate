import { useState } from "react";

export interface SocialAuthButtonsProps {
  onGoogle: () => void;
  disabled?: boolean;
}

interface SocialButtonProps {
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  label: string;
  icon: React.ReactNode;
}

/**
 * SocialAuthButtons — "Continue with Google" secondary button for the login
 * modal, matching LoginDialog's inline-style `--le-*` token pattern (bordered
 * secondary buttons, not the filled accent primary). Brand marks are
 * hand-written inline SVGs — no new dependency.
 */
export function SocialAuthButtons({
  onGoogle,
  disabled,
}: SocialAuthButtonsProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SocialButton
        onClick={onGoogle}
        disabled={disabled}
        ariaLabel="Continue with Google"
        label="Continue with Google"
        icon={<GoogleIcon />}
      />
    </div>
  );
}

function SocialButton({
  onClick,
  disabled,
  ariaLabel,
  label,
  icon,
}: SocialButtonProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: 46,
        border: "1px solid var(--le-border-strong)",
        borderRadius: 4,
        background:
          hovered && !disabled ? "var(--le-bg-sunken)" : "var(--le-bg)",
        color: "var(--le-text)",
        fontFamily: "var(--le-font-sans)",
        fontSize: 14,
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.15s ease",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 16,
          top: "50%",
          transform: "translateY(-50%)",
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 18 18"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.8741 2.6836-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.8591-3.0477.8591-2.344 0-4.3282-1.5831-5.0359-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.9641 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1023-1.17.2823-1.71V4.9582H.9573C.3477 6.1732 0 7.5477 0 9s.3477 2.8268.9573 4.0418L3.9641 10.71z"
      />
      <path
        fill="#EA4335"
        d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.9641 7.29C4.6718 5.1627 6.656 3.5795 9 3.5795z"
      />
    </svg>
  );
}

