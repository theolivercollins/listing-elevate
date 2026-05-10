// Tiny loader for the Google Maps JS API (Places library only).
// Idempotent — multiple callers share the same script + the same promise.
// Gracefully no-ops if VITE_GOOGLE_MAPS_API_KEY is missing.

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (input: HTMLInputElement, opts?: unknown) => GoogleAutocomplete;
        };
      };
    };
    __googleMapsLoadPromise__?: Promise<boolean>;
  }
}

export interface GoogleAddressComponent {
  short_name: string;
  long_name: string;
  types: string[];
}

export interface GooglePlaceResult {
  address_components?: GoogleAddressComponent[];
  formatted_address?: string;
}

export interface GoogleAutocomplete {
  addListener: (event: string, fn: () => void) => void;
  getPlace: () => GooglePlaceResult;
  setFields: (fields: string[]) => void;
  setComponentRestrictions: (r: { country: string | string[] }) => void;
}

/**
 * Returns true if the Maps JS API is loaded and Places is available.
 * Resolves to false if no key is set or the script fails to load.
 */
export function loadGoogleMaps(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.google?.maps?.places) return Promise.resolve(true);
  if (window.__googleMapsLoadPromise__) return window.__googleMapsLoadPromise__;

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!key) {
    console.warn("[googleMaps] VITE_GOOGLE_MAPS_API_KEY not set — autocomplete disabled");
    return Promise.resolve(false);
  }

  window.__googleMapsLoadPromise__ = new Promise<boolean>((resolve) => {
    const cb = "__gmapsReady__" + Math.random().toString(36).slice(2);
    (window as unknown as Record<string, unknown>)[cb] = () => resolve(true);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=${cb}&v=weekly`;
    s.async = true;
    s.defer = true;
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return window.__googleMapsLoadPromise__;
}

/**
 * Parse Google's `address_components` array into the flat shape our form uses.
 * Falls back to empty string for missing pieces — the user can still complete
 * the form by typing.
 */
export interface ParsedAddress {
  line1: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
}

export function parsePlaceToAddress(place: GooglePlaceResult): ParsedAddress {
  const comps = place.address_components ?? [];
  const get = (type: string, useShort = false): string => {
    const c = comps.find((c) => c.types.includes(type));
    return c ? (useShort ? c.short_name : c.long_name) : "";
  };
  const streetNumber = get("street_number");
  const route = get("route");
  const line1 = [streetNumber, route].filter(Boolean).join(" ");
  return {
    line1,
    city:
      get("locality") ||
      get("sublocality_level_1") ||
      get("postal_town") ||
      get("administrative_area_level_2"),
    state: get("administrative_area_level_1", true),
    postal_code: get("postal_code"),
    country: get("country", true), // 2-letter ISO code
  };
}
