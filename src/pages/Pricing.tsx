import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const pricingItems = [
  {
    title: "30 second ad",
    price: "$150",
    description: "A complete short-form commercial built for paid social, web, and listing promotion.",
    label: "Most requested",
    featured: true,
  },
  {
    title: "15 second ad",
    price: "$125",
    description: "A tighter spot for reels, stories, and quick campaign variations.",
    label: "Single ad",
    featured: false,
  },
  {
    title: "6 second ad",
    price: "$85",
    description: "A fast bumper clip for retargeting, hooks, and high-frequency placement.",
    label: "Single ad",
    featured: false,
  },
];

const includedItems = [
  "All created clips released and included",
  "Modern AI commercial asset creation",
  "Simple per-ad pricing with no complicated packages",
];

const setupItems = [
  {
    label: "New business setup",
    price: "$75",
    meta: "one-time onboarding fee",
    description: "Covers setup for a new business so future commercial assets can be produced quickly and consistently.",
  },
  {
    label: "Optional licensing",
    price: "$25",
    meta: "audio media licensing fee",
    description: "Added when a commercial requires licensed audio media for distribution.",
  },
];

export default function Pricing() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="relative overflow-hidden border-b border-border bg-[radial-gradient(circle_at_top_right,_hsl(var(--accent)/0.12),_transparent_34%),linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--secondary))_100%)]">
        <div className="mx-auto flex min-h-[72vh] w-full max-w-7xl flex-col justify-center px-6 py-24 sm:px-8 lg:px-10">
          <div className="max-w-4xl">
            <Badge variant="outline" className="mb-6 border-accent/40 text-accent">
              AI Commercial Asset Creation
            </Badge>
            <h1 className="display-xl max-w-5xl text-balance">
              Simple pricing for high-converting AI commercials.
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
              Create polished, platform-ready ad assets without the overhead of a traditional production process. Pick the ad length you need, then launch with every clip released and included.
            </p>
            <div className="mt-10 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <a href="mailto:hello@listingelevate.com?subject=AI%20Commercial%20Asset%20Creation">Start a project</a>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href="#pricing">View pricing</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto w-full max-w-7xl px-6 py-16 sm:px-8 lg:px-10 lg:py-24">
        <div className="mb-10 grid gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
          <div>
            <Badge variant="outline" className="mb-4 text-muted-foreground">
              Pricing
            </Badge>
            <h2 className="display-md">Choose the clip length that fits the placement.</h2>
          </div>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground lg:ml-auto">
            A one-time onboarding fee applies for every new business. Audio media licensing is available as a separate add-on when licensed audio is needed for the campaign.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {pricingItems.map((item) => (
            <Card
              key={item.title}
              className={item.featured ? "border-primary bg-primary text-primary-foreground" : "bg-card"}
            >
              <CardHeader className="p-6 pb-0 sm:p-8 sm:pb-0">
                <Badge
                  variant="outline"
                  className={
                    item.featured
                      ? "mb-10 w-fit border-primary-foreground/20 text-primary-foreground/80"
                      : "mb-10 w-fit text-muted-foreground"
                  }
                >
                  {item.label}
                </Badge>
                <CardTitle className="text-2xl">{item.title}</CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-6 sm:p-8 sm:pt-6">
                <div className="flex items-end gap-2">
                  <span className="text-6xl font-semibold tracking-[-0.06em] tabular">{item.price}</span>
                  <span className={item.featured ? "pb-2 text-sm text-primary-foreground/70" : "pb-2 text-sm text-muted-foreground"}>
                    per ad
                  </span>
                </div>
                <CardDescription className={item.featured ? "mt-6 leading-7 text-primary-foreground/70" : "mt-6 leading-7"}>
                  {item.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {setupItems.map((item) => (
            <Card key={item.label} className="bg-secondary/60">
              <CardHeader className="p-6 pb-0 sm:p-8 sm:pb-0">
                <Badge variant="outline" className="mb-6 w-fit text-muted-foreground">
                  {item.label}
                </Badge>
              </CardHeader>
              <CardContent className="p-6 pt-0 sm:p-8 sm:pt-0">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:gap-2">
                  <span className="text-5xl font-semibold tracking-[-0.05em] tabular">{item.price}</span>
                  <span className="pb-2 text-sm text-muted-foreground">{item.meta}</span>
                </div>
                <p className="mt-6 leading-7 text-muted-foreground">{item.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mt-4 bg-card">
          <CardContent className="p-6 sm:p-8">
            <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
              <div>
                <Badge variant="outline" className="mb-4 border-accent/40 text-accent">
                  Included
                </Badge>
                <h2 className="text-3xl font-semibold tracking-tight">No hidden clip release fees.</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                {includedItems.map((item) => (
                  <Card key={item} className="bg-secondary/60">
                    <CardContent className="p-4 text-sm font-medium leading-6 text-muted-foreground">{item}</CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-14 border-primary bg-primary text-primary-foreground">
          <CardContent className="p-8 sm:p-10 lg:flex lg:items-center lg:justify-between">
            <div>
              <Badge variant="outline" className="mb-4 border-primary-foreground/20 text-primary-foreground/80">
                Ready when you are
              </Badge>
              <h2 className="text-3xl font-semibold tracking-tight">Start with onboarding, then order the ad lengths you need.</h2>
            </div>
            <Separator className="my-8 bg-primary-foreground/15 lg:hidden" />
            <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto lg:ml-8">
              <a href="mailto:hello@listingelevate.com?subject=AI%20Commercial%20Asset%20Creation">Request assets</a>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
