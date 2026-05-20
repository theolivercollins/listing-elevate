import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps, type GMapsAutocomplete } from '@/lib/google-maps-loader';

export type AddressDetails = {
  formatted_address: string;
  place_id: string | null;
  lat: number | null;
  lng: number | null;
};

export function AddressAutocomplete({
  value,
  onChange,
  onPick,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick?: (d: AddressDetails) => void;
  placeholder?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const acRef = useRef<GMapsAutocomplete | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !inputRef.current) return;
        const ac = new g.maps.places.Autocomplete(inputRef.current, {
          fields: ['formatted_address', 'place_id', 'geometry.location'],
          types: ['address'],
          componentRestrictions: { country: ['us'] },
        });
        acRef.current = ac;
        ac.addListener('place_changed', () => {
          const p = ac.getPlace();
          const formatted = p.formatted_address ?? inputRef.current?.value ?? '';
          onChange(formatted);
          onPick?.({
            formatted_address: formatted,
            place_id: p.place_id ?? null,
            lat: p.geometry?.location?.lat() ?? null,
            lng: p.geometry?.location?.lng() ?? null,
          });
        });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // onChange / onPick are intentionally not deps — capture once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <input
        ref={inputRef}
        className={className ?? 'studio-input'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '208 Berry Street, Brooklyn, NY'}
        autoComplete="off"
      />
      {loadError && (
        <p style={{ marginTop: 6, fontSize: 11.5, color: 'var(--le-warn)' }}>
          Address autocomplete unavailable ({loadError}). You can still type the address manually.
        </p>
      )}
    </div>
  );
}
