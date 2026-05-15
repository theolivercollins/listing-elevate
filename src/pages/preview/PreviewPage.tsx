import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

type PreviewData = {
  address: string;
  video_url: string | null;
  brand: { logo: string | null; agent_name: string | null; name: string } | null;
};

export default function PreviewPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PreviewData | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    fetch(`/api/preview/${token}`).then(async r => {
      if (r.status === 404) { setNotFound(true); return; }
      const d = await r.json();
      setData(d);
    });
  }, [token]);

  const submit = async () => {
    if (!note.trim() || submitting) return;
    setSubmitting(true);
    const r = await fetch(`/api/preview/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: note }),
    });
    setSubmitting(false);
    if (r.ok) { setSubmitted(true); setNote(''); }
  };

  if (notFound) return <div className="p-8 text-center text-muted-foreground">This preview is no longer available.</div>;
  if (!data) return <div className="p-8 text-center">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      {data.brand?.logo && <img src={data.brand.logo} alt="" className="h-12" />}
      <h1 className="text-xl font-medium">{data.address}</h1>
      {data.video_url ? (
        <video src={data.video_url} controls className="w-full rounded" />
      ) : (
        <div className="text-muted-foreground">Video not yet available.</div>
      )}
      {data.brand?.agent_name && (
        <div className="text-sm text-muted-foreground">
          {data.brand.agent_name}{data.brand.name ? ` · ${data.brand.name}` : ''}
        </div>
      )}

      <div className="border-t pt-4">
        <label className="text-sm font-medium">Request a change</label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Anything you'd like adjusted? (one revision included)"
          className="w-full mt-2 border rounded p-2 text-sm"
        />
        <button
          onClick={submit}
          disabled={submitting || !note.trim() || submitted}
          className="mt-2 px-3 py-1.5 text-sm border rounded disabled:opacity-50"
        >
          {submitted ? 'Submitted' : submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
