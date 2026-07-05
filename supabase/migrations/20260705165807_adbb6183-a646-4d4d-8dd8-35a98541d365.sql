
ALTER TABLE public.events
  ADD COLUMN waiver_text text NOT NULL DEFAULT
$$LIABILITY WAIVER, ASSUMPTION OF RISK & RELEASE

By entering the event, I acknowledge that attendance is voluntary and involves inherent risks, including but not limited to physical contact, adult-themed performances, alcohol service, and interaction with other adult guests. I confirm I am at least 18 years old.

I assume all risk of personal injury, illness, or property loss arising from my participation. I release and hold harmless the host, venue, performers, staff, and other guests from any and all claims arising from my attendance, except in cases of gross negligence or wilful misconduct.

I agree to abide by the house rules, respect consent at all times, and follow all reasonable instructions from staff. I understand I may be removed without refund for violating these terms.

I confirm the video / photography preferences I selected are accurate and consent to their enforcement by staff.$$;

ALTER TABLE public.rsvps
  ADD COLUMN waiver_signature text,
  ADD COLUMN waiver_accepted_at timestamptz,
  ADD COLUMN waiver_text_hash text;
