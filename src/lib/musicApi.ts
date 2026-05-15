// src/lib/musicApi.ts
import { supabase } from "./supabase";

export interface MusicTrack {
  id: string;
  name: string;
  file_url: string;
  mood_tag: "upbeat" | "warm" | "celebratory" | "cinematic" | "neutral";
  duration_seconds: number | null;
  license: string | null;
  attribution: string | null;
  active: boolean;
  created_at: string;
}

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}: ${body || "request failed"}`);
  }
  return res.json() as Promise<T>;
}

export async function listTracks(): Promise<{ tracks: MusicTrack[] }> {
  const res = await fetch("/api/admin/music", { headers: await authHeaders() });
  return asJson(res);
}

export async function uploadTrack(
  file: File,
  meta: { name: string; mood_tag: string; license?: string; attribution?: string },
  onProgress?: (pct: number) => void
): Promise<{ track: MusicTrack }> {
  const headers = await authHeaders();
  const form = new FormData();
  form.append("file", file);
  form.append("name", meta.name);
  form.append("mood_tag", meta.mood_tag);
  if (meta.license) form.append("license", meta.license);
  if (meta.attribution) form.append("attribution", meta.attribution);

  // Use XMLHttpRequest for upload progress support.
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/music");
    const authHeader = (headers as Record<string, string>)["Authorization"];
    if (authHeader) xhr.setRequestHeader("Authorization", authHeader);

    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`${xhr.status}: ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(form);
  });
}

export async function patchTrack(
  id: string,
  patch: Partial<Pick<MusicTrack, "name" | "mood_tag" | "license" | "attribution" | "active">>
): Promise<{ track: MusicTrack }> {
  const res = await fetch(`/api/admin/music/${id}`, {
    method: "PATCH",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return asJson(res);
}

export async function deleteTrack(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/admin/music/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  return asJson(res);
}
