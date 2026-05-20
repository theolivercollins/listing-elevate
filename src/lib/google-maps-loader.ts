// Minimal lazy loader for the Google Maps JS API + Places library.
// Restricted-by-referrer frontend key is ok to ship in the bundle.

export type GMapsPlace = {
  formatted_address?: string;
  place_id?: string;
  geometry?: { location?: { lat: () => number; lng: () => number } };
};
export type GMapsAutocomplete = {
  addListener: (ev: string, cb: () => void) => void;
  getPlace: () => GMapsPlace;
};
export type GMapsApi = {
  maps: {
    places: {
      Autocomplete: new (
        input: HTMLInputElement,
        opts: {
          fields?: string[];
          types?: string[];
          componentRestrictions?: { country: string[] };
        },
      ) => GMapsAutocomplete;
    };
  };
};

let inflight: Promise<GMapsApi> | null = null;

declare global {
  interface Window {
    google?: GMapsApi;
  }
}

export function loadGoogleMaps(): Promise<GMapsApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('google maps loader requires window'));
  }
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (inflight) return inflight;

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!key) return Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY not set'));

  inflight = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google!));
      existing.addEventListener('error', () => reject(new Error('failed to load google maps')));
      return;
    }
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&v=quarterly`;
    s.async = true;
    s.defer = true;
    s.dataset.googleMaps = '1';
    s.onload = () => resolve(window.google!);
    s.onerror = () => reject(new Error('failed to load google maps'));
    document.head.appendChild(s);
  });

  return inflight;
}
