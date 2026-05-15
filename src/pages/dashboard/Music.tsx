import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Pencil, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import {
  listTracks,
  uploadTrack,
  patchTrack,
  deleteTrack,
  type MusicTrack,
} from "@/lib/musicApi";

const MOOD_TAGS = ["upbeat", "warm", "celebratory", "cinematic", "neutral"] as const;

const MOOD_COLORS: Record<string, string> = {
  upbeat: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  warm: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  celebratory: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  cinematic: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  neutral: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

// ─── Upload modal ─────────────────────────────────────────────────────────────

interface UploadModalProps {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

function UploadModal({ open, onClose, onDone }: UploadModalProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [moodTag, setMoodTag] = useState<string>("");
  const [license, setLicense] = useState("");
  const [attribution, setAttribution] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setName("");
    setMoodTag("");
    setLicense("");
    setAttribution("");
    setProgress(null);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!file) { setError("Please select a file."); return; }
    if (!name.trim()) { setError("Name is required."); return; }
    if (!moodTag) { setError("Mood tag is required."); return; }

    setProgress(0);
    try {
      await uploadTrack(file, { name, mood_tag: moodTag, license, attribution }, setProgress);
      toast.success("Track uploaded");
      reset();
      onDone();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload track</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* File picker */}
          <div className="space-y-1">
            <Label>Audio file (mp3, m4a or wav — max 20 MB)</Label>
            <div
              className="flex cursor-pointer items-center justify-center rounded border-2 border-dashed border-border p-6 text-sm text-muted-foreground hover:border-foreground/40 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              {file ? (
                <span className="font-medium text-foreground">{file.name}</span>
              ) : (
                "Click to choose file…"
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="audio/mpeg,audio/mp4,audio/m4a,audio/wav,.mp3,.m4a,.wav"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {/* Name */}
          <div className="space-y-1">
            <Label htmlFor="track-name">Name</Label>
            <Input
              id="track-name"
              placeholder="e.g. Bright Beginnings"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Mood tag */}
          <div className="space-y-1">
            <Label>Mood</Label>
            <Select value={moodTag} onValueChange={setMoodTag}>
              <SelectTrigger>
                <SelectValue placeholder="Select mood…" />
              </SelectTrigger>
              <SelectContent>
                {MOOD_TAGS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* License */}
          <div className="space-y-1">
            <Label htmlFor="track-license">License (optional)</Label>
            <Input
              id="track-license"
              placeholder="e.g. Royalty-free / CC0"
              value={license}
              onChange={(e) => setLicense(e.target.value)}
            />
          </div>

          {/* Attribution */}
          <div className="space-y-1">
            <Label htmlFor="track-attribution">Attribution (optional)</Label>
            <Input
              id="track-attribution"
              placeholder="e.g. Artist Name — track title"
              value={attribution}
              onChange={(e) => setAttribution(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {progress !== null && (
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">{progress}%</div>
              <div className="h-1 rounded bg-muted">
                <div
                  className="h-1 rounded bg-foreground transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => { reset(); onClose(); }}
              disabled={progress !== null}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={progress !== null}>
              {progress !== null ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

interface EditModalProps {
  track: MusicTrack;
  onClose: () => void;
  onSaved: () => void;
}

function EditModal({ track, onClose, onSaved }: EditModalProps) {
  const [name, setName] = useState(track.name);
  const [moodTag, setMoodTag] = useState<string>(track.mood_tag);
  const [license, setLicense] = useState(track.license ?? "");
  const [attribution, setAttribution] = useState(track.attribution ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await patchTrack(track.id, {
        name: name.trim() || track.name,
        mood_tag: moodTag as MusicTrack["mood_tag"],
        license: license || null,
        attribution: attribution || null,
      });
      toast.success("Track updated");
      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit track</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label>Mood</Label>
            <Select value={moodTag} onValueChange={setMoodTag}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOOD_TAGS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-license">License</Label>
            <Input
              id="edit-license"
              value={license}
              onChange={(e) => setLicense(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-attribution">Attribution</Label>
            <Input
              id="edit-attribution"
              value={attribution}
              onChange={(e) => setAttribution(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MusicLibrary() {
  const qc = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<MusicTrack | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["music-tracks"],
    queryFn: listTracks,
  });

  const allTracks = data?.tracks ?? [];
  const activeTracks = allTracks.filter((t) => t.active);
  const visible = showInactive ? allTracks : activeTracks;

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      patchTrack(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["music-tracks"] }),
    onError: () => toast.error("Failed to update track"),
  });

  const softDelete = useMutation({
    mutationFn: (id: string) => deleteTrack(id),
    onSuccess: () => {
      toast.success("Track deactivated");
      qc.invalidateQueries({ queryKey: ["music-tracks"] });
    },
    onError: () => toast.error("Failed to delete track"),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["music-tracks"] });
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          Music library{" "}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {activeTracks.length} active
          </span>
        </h1>
        <Button onClick={() => setUploadOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Upload track
        </Button>
      </div>

      {/* Show inactive toggle */}
      <div className="mb-4 flex items-center gap-2">
        <input
          id="show-inactive"
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        <label htmlFor="show-inactive" className="text-sm text-muted-foreground cursor-pointer">
          Show inactive tracks
        </label>
      </div>

      {/* Track list */}
      {isLoading ? (
        <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          {allTracks.length === 0
            ? "No music yet — upload your first track."
            : "No active tracks — check "Show inactive" to see archived tracks."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Mood</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Preview</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">License</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Attribution</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground">Active</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((track) => (
                <tr
                  key={track.id}
                  className={`transition-colors hover:bg-muted/20 ${!track.active ? "opacity-50" : ""}`}
                >
                  <td className="px-4 py-3 font-medium">{track.name}</td>

                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium ${MOOD_COLORS[track.mood_tag] ?? ""}`}
                    >
                      {track.mood_tag}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <audio
                      controls
                      src={track.file_url}
                      preload="none"
                      className="h-8 w-48 max-w-full"
                    />
                  </td>

                  <td className="px-4 py-3 text-muted-foreground max-w-[160px] truncate">
                    {track.license ?? "—"}
                  </td>

                  <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate">
                    {track.attribution ?? "—"}
                  </td>

                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      title={track.active ? "Deactivate" : "Activate"}
                      onClick={() =>
                        toggleActive.mutate({ id: track.id, active: !track.active })
                      }
                      className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <CheckCircle2
                        className={`h-4 w-4 ${track.active ? "text-green-500" : "text-muted-foreground/40"}`}
                        strokeWidth={1.5}
                      />
                    </button>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => setEditing(track)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-destructive hover:text-destructive"
                        onClick={() => {
                          if (window.confirm(`Deactivate "${track.name}"? It will be hidden but the audio URL stays intact for existing videos.`)) {
                            softDelete.mutate(track.id);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onDone={invalidate}
      />

      {editing && (
        <EditModal
          track={editing}
          onClose={() => setEditing(null)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}
