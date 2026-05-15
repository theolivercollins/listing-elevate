/**
 * AddressAutocomplete
 *
 * Wraps a standard text <input> and attaches Google Places Autocomplete,
 * restricted to US addresses. Loads the Maps JS script lazily — does not
 * block app boot if VITE_GOOGLE_MAPS_API_KEY is not set.
 */

import { useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// Lazy Maps loader — singleton per tab
// ---------------------------------------------------------------------------
let mapsLoader: Promise<void> | null = null;

function loadGoogleMaps(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as Record<string, unknown>).google && (window as unknown as { google: { maps?: { places?: unknown } } }).google.maps?.places) return Promise.resolve();
  if (mapsLoader) return mapsLoader;
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!key) return Promise.reject(new Error("VITE_GOOGLE_MAPS_API_KEY not set"));
  mapsLoader = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places&v=quarterly`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(s);
  });
  return mapsLoader;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface GooglePlaceResult {
  formatted_address?: string;
  address_components?: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
}

export interface AddressAutocompleteProps {
  value: string;
  onChange: (formatted: string) => void;
  /** Optional callback with the full Place result for structured data extraction. */
  onPlace?: (place: GooglePlaceResult) => void;
  placeholder?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function AddressAutocomplete({
  value,
  onChange,
  onPlace,
  placeholder = "208 Berry Street, Brooklyn, NY",
  className,
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<unknown>(null);

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !inputRef.current) return;
        const g = (window as Record<string, unknown>).google as {
          maps: {
            places: {
              Autocomplete: new (
                el: HTMLInputElement,
                opts: object,
              ) => {
                addListener: (event: string, cb: () => void) => void;
                getPlace: () => GooglePlaceResult;
              };
            };
          };
        };

        const ac = new g.maps.places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: "us" },
          types: ["address"],
          fields: ["formatted_address", "address_components"],
        });

        ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          const formatted = place.formatted_address ?? inputRef.current?.value ?? "";
          onChange(formatted);
          onPlace?.(place);
        });

        autocompleteRef.current = ac;
      })
      .catch(() => {
        // Maps failed to load — input still works as a plain text field.
      });

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={className}
      autoComplete="off"
    />
  );
}
