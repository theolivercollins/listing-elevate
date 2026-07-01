import { PageHeading } from "reelready";
import { Icon } from "reelready";

export const Default = () => (
  <div style={{ padding: 24, maxWidth: 640 }}>
    <PageHeading
      eyebrow="Today · Monday 1 July"
      title="Good morning, Oliver."
      sub="3 delivered today · 7 in production · 2 need review"
      actions={
        <a className="le-btn-dark" href="#">
          <Icon name="plus" size={13} /> New listing
        </a>
      }
    />
  </div>
);

export const Minimal = () => (
  <div style={{ padding: 24, maxWidth: 640 }}>
    <PageHeading
      title="142 Birchwood Lane"
      sub="Colonial · 4 bed / 3 bath · Listed by Dana Whitfield Realty"
    />
  </div>
);
