import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type Script = {
  title: string;
  situation: string;
  say: string[];
  follow_up?: string;
};

const SCRIPTS: { section: string; items: Script[] }[] = [
  {
    section: "Someone is making a guest uncomfortable",
    items: [
      {
        title: "Interrupt & extract",
        situation:
          "A guest is being pressured, cornered, or their body language says they want out.",
        say: [
          "\"Hey — sorry to interrupt. I need to borrow you for a second.\"",
          "\"There's someone at the bar asking for you, come with me.\"",
          "\"Can I steal you? I need a hand with something quickly.\"",
        ],
        follow_up:
          "Walk them to a safe spot, ask calmly: \"Are you okay? Do you want me to keep them away from you tonight?\"",
      },
      {
        title: "Name the behaviour to the aggressor",
        situation: "You need to stop the behaviour without escalating.",
        say: [
          "\"That's not okay here. Please give her space.\"",
          "\"She's said no — I need you to step back.\"",
          "\"We're a consent-first space. That behaviour ends now.\"",
        ],
        follow_up:
          "If they don't step back, radio the lead host and stay between them and the guest.",
      },
    ],
  },
  {
    section: "Consent check — reading the room",
    items: [
      {
        title: "Quiet consent check",
        situation:
          "You're not sure if a guest is okay with what's happening around them.",
        say: [
          "\"Hey, just checking in — you good?\"",
          "\"Tap me on the shoulder if you want out at any point, no explanation needed.\"",
          "\"Is this the vibe you wanted, or do you want a reset?\"",
        ],
      },
      {
        title: "Offering an exit line",
        situation:
          "Give a guest a socially safe way to leave a conversation they're stuck in.",
        say: [
          "\"Your friend is looking for you — let's go find them.\"",
          "\"I need you for a photo, come with me real quick.\"",
        ],
      },
    ],
  },
  {
    section: "Intoxication & capacity",
    items: [
      {
        title: "Guest appears too intoxicated to consent",
        situation:
          "Slurring, unsteady, blackouts, or being led away by someone.",
        say: [
          "\"I'm going to sit with you for a minute — you look like you need water.\"",
          "\"She's not in a state to make that call tonight. I'll take it from here.\"",
        ],
        follow_up:
          "Get them water, a seat, and a trusted friend. Do NOT let them leave with someone you don't know. File a Safety Incident report before end of shift.",
      },
    ],
  },
  {
    section: "Photography without consent",
    items: [
      {
        title: "Phone or camera in the room",
        situation:
          "A guest is filming or photographing others without permission.",
        say: [
          "\"No photos or video inside — I need you to put the phone away.\"",
          "\"If I see it again I have to ask you to leave. Please delete anything you've already taken.\"",
        ],
        follow_up:
          "Watch discreetly for 10 minutes. Escalate to the lead host if it continues.",
      },
    ],
  },
  {
    section: "Escalate immediately",
    items: [
      {
        title: "When to stop scripting and get help",
        situation:
          "Threats, physical contact, weapons, a guest who won't disengage, or anything that scares you.",
        say: [
          "\"Lead host to the floor, now.\" (radio / group chat)",
          "To the guest: \"Come with me — we're getting you out of here.\"",
        ],
        follow_up:
          "Your job is not to be security. Get the guest to safety, then let the lead host handle removal. File a Safety Incident report the same night.",
      },
    ],
  },
];

export function QuickAccessButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-primary/60 bg-primary px-4 py-3 text-xs font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 sm:static sm:shadow-none sm:bg-primary/10 sm:text-primary sm:hover:bg-primary/20"
        aria-label="Open consent intervention quick access"
      >
        <span aria-hidden>⚡</span> Quick Access
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] w-[95vw] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-primary">
              Quick Access · Co-host scripts
            </div>
            <DialogTitle className="font-display text-2xl">
              Consent Intervention Scripts
            </DialogTitle>
            <DialogDescription>
              Use these exact phrases when you need words fast. Your safety and
              the guest's safety come first — escalate to the lead host any
              time you feel unsure.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-6">
            {SCRIPTS.map((section) => (
              <section key={section.section}>
                <h3 className="text-[11px] font-semibold uppercase tracking-widest text-primary">
                  {section.section}
                </h3>
                <div className="mt-2 space-y-3">
                  {section.items.map((item) => (
                    <article
                      key={item.title}
                      className="rounded-lg border border-border/70 bg-card/60 p-3"
                    >
                      <div className="font-display text-base">{item.title}</div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.situation}
                      </p>
                      <ul className="mt-2 space-y-1.5 text-sm">
                        {item.say.map((line, i) => (
                          <li
                            key={i}
                            className="rounded-md border-l-2 border-primary/50 bg-primary/5 px-3 py-2 leading-snug"
                          >
                            {line}
                          </li>
                        ))}
                      </ul>
                      {item.follow_up && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          <span className="font-semibold uppercase tracking-widest text-primary/80">
                            Then:{" "}
                          </span>
                          {item.follow_up}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            ))}

            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-100">
              <div className="font-semibold uppercase tracking-widest text-red-300">
                Emergency
              </div>
              <p className="mt-1">
                For threats, violence, or medical emergencies call local
                emergency services first. Then radio the lead host and file a
                Safety Incident report before the shift ends.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
