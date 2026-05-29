const pricingItems = [
  {
    title: "30 second ad",
    price: "$150",
    description: "A complete short-form commercial built for paid social, web, and listing promotion.",
    featured: true,
  },
  {
    title: "15 second ad",
    price: "$125",
    description: "A tighter spot for reels, stories, and quick campaign variations.",
    featured: false,
  },
  {
    title: "6 second ad",
    price: "$85",
    description: "A fast bumper clip for retargeting, hooks, and high-frequency placement.",
    featured: false,
  },
];

const includedItems = [
  "All created clips released and included",
  "Modern AI commercial asset creation",
  "Simple per-ad pricing with no complicated packages",
];

export default function Pricing() {
  return (
    <main className="min-h-screen bg-white text-slate-950">
      <section className="relative overflow-hidden border-b border-slate-200 bg-[radial-gradient(circle_at_top_right,_rgba(37,99,235,0.12),_transparent_34%),linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)]">
        <div className="mx-auto flex min-h-[72vh] w-full max-w-7xl flex-col justify-center px-6 py-24 sm:px-8 lg:px-10">
          <div className="max-w-4xl">
            <p className="label mb-6 text-blue-600">AI Commercial Asset Creation</p>
            <h1 className="display-xl max-w-5xl text-balance">
              Simple pricing for high-converting AI commercials.
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
              Create polished, platform-ready ad assets without the overhead of a traditional production process. Pick the ad length you need, then launch with every clip released and included.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <a
                href="mailto:hello@listingelevate.com?subject=AI%20Commercial%20Asset%20Creation"
                className="inline-flex h-12 items-center justify-center border border-slate-950 bg-slate-950 px-6 text-sm font-semibold text-white transition hover:bg-white hover:text-slate-950"
              >
                Start a project
              </a>
              <a
                href="#pricing"
                className="inline-flex h-12 items-center justify-center border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-950 transition hover:border-slate-950"
              >
                View pricing
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-7xl px-6 py-16 sm:px-8 lg:px-10 lg:py-24">
        <div className="mb-10 grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <div>
            <p className="label mb-4 text-slate-500">Pricing</p>
            <h2 className="display-md">Choose the clip length that fits the placement.</h2>
          </div>
          <p className="max-w-2xl text-base leading-7 text-slate-600 lg:ml-auto">
            A one-time onboarding fee applies for every new business. Audio media licensing is available as a separate add-on when licensed audio is needed for the campaign.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {pricingItems.map((item) => (
            <article
              key={item.title}
              className={`relative border p-6 sm:p-8 ${
                item.featured
                  ? "border-slate-950 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-950"
              }`}
            >
              {item.featured ? (
                <span className="mb-10 inline-flex border border-white/20 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-blue-200">
                  Most requested
                </span>
              ) : (
                <span className="mb-10 inline-flex border border-slate-200 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                  Single ad
                </span>
              )}
              <h3 className="text-2xl font-semibold tracking-tight">{item.title}</h3>
              <div className="mt-6 flex items-end gap-2">
                <span className="text-6xl font-semibold tracking-[-0.06em] tabular">{item.price}</span>
                <span className={item.featured ? "pb-2 text-sm text-slate-300" : "pb-2 text-sm text-slate-500"}>per ad</span>
              </div>
              <p className={item.featured ? "mt-6 leading-7 text-slate-300" : "mt-6 leading-7 text-slate-600"}>{item.description}</p>
            </article>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <article className="border border-slate-200 bg-slate-50 p-6 sm:p-8">
            <p className="label mb-6 text-slate-500">New business setup</p>
            <div className="flex items-end gap-2">
              <span className="text-5xl font-semibold tracking-[-0.05em] tabular">$75</span>
              <span className="pb-2 text-sm text-slate-500">one-time onboarding fee</span>
            </div>
            <p className="mt-6 leading-7 text-slate-600">
              Covers setup for a new business so future commercial assets can be produced quickly and consistently.
            </p>
          </article>

          <article className="border border-slate-200 bg-slate-50 p-6 sm:p-8">
            <p className="label mb-6 text-slate-500">Optional licensing</p>
            <div className="flex items-end gap-2">
              <span className="text-5xl font-semibold tracking-[-0.05em] tabular">$25</span>
              <span className="pb-2 text-sm text-slate-500">audio media licensing fee</span>
            </div>
            <p className="mt-6 leading-7 text-slate-600">
              Added when a commercial requires licensed audio media for distribution.
            </p>
          </article>
        </div>

        <div className="mt-4 border border-slate-200 bg-white p-6 sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <p className="label mb-4 text-blue-600">Included</p>
              <h2 className="text-3xl font-semibold tracking-tight">No hidden clip release fees.</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {includedItems.map((item) => (
                <div key={item} className="border border-slate-200 bg-slate-50 p-4 text-sm font-medium leading-6 text-slate-700">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-14 border border-slate-950 bg-slate-950 p-8 text-white sm:p-10 lg:flex lg:items-center lg:justify-between">
          <div>
            <p className="label mb-4 text-blue-200">Ready when you are</p>
            <h2 className="text-3xl font-semibold tracking-tight">Start with onboarding, then order the ad lengths you need.</h2>
          </div>
          <a
            href="mailto:hello@listingelevate.com?subject=AI%20Commercial%20Asset%20Creation"
            className="mt-8 inline-flex h-12 items-center justify-center border border-white bg-white px-6 text-sm font-semibold text-slate-950 transition hover:bg-slate-950 hover:text-white lg:mt-0"
          >
            Request assets
          </a>
        </div>
      </section>
    </main>
  );
}
