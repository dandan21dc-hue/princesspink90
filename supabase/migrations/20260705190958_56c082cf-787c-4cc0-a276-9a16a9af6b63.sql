
ALTER TABLE public.rsvps ADD COLUMN entry_phrase text;

CREATE OR REPLACE FUNCTION public.rsvps_assign_entry_phrase()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  phrases text[] := ARRAY[
    'Velvet Night','Crimson Silk','Midnight Lace','Shadow Play',
    'Ruby Whisper','Onyx Bloom','Sable Waltz','Ember Veil',
    'Amber Trance','Obsidian Kiss','Rose Ash','Ivory Chain',
    'Moonlit Vow','Neon Reverie','Silver Thread','Scarlet Ember',
    'Twilight Bloom','Lace Mirage','Plum Reverie','Midnight Orchid',
    'Velvet Ember','Wicked Rose','Hush Parlour','Sapphire Hush'
  ];
  chosen text;
  attempt int := 0;
BEGIN
  IF NEW.entry_phrase IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Prefer a phrase not already used at this event.
  FOR chosen IN
    SELECT p FROM unnest(phrases) AS p ORDER BY random()
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.rsvps
      WHERE event_id = NEW.event_id AND entry_phrase = chosen
    ) THEN
      NEW.entry_phrase := chosen;
      RETURN NEW;
    END IF;
  END LOOP;

  -- Fallback if all base phrases are taken at this event: append a suffix.
  chosen := phrases[1 + floor(random() * array_length(phrases,1))::int];
  LOOP
    attempt := attempt + 1;
    IF NOT EXISTS (
      SELECT 1 FROM public.rsvps
      WHERE event_id = NEW.event_id AND entry_phrase = chosen || ' ' || attempt
    ) THEN
      NEW.entry_phrase := chosen || ' ' || attempt;
      RETURN NEW;
    END IF;
    EXIT WHEN attempt > 500;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rsvps_assign_entry_phrase_trg
  BEFORE INSERT ON public.rsvps
  FOR EACH ROW EXECUTE FUNCTION public.rsvps_assign_entry_phrase();

CREATE UNIQUE INDEX rsvps_event_entry_phrase_uidx
  ON public.rsvps (event_id, entry_phrase);

-- Backfill existing rows one at a time so the same trigger logic applies
-- (guarantees per-event uniqueness even for legacy bookings).
DO $$
DECLARE
  r record;
  phrases text[] := ARRAY[
    'Velvet Night','Crimson Silk','Midnight Lace','Shadow Play',
    'Ruby Whisper','Onyx Bloom','Sable Waltz','Ember Veil',
    'Amber Trance','Obsidian Kiss','Rose Ash','Ivory Chain',
    'Moonlit Vow','Neon Reverie','Silver Thread','Scarlet Ember',
    'Twilight Bloom','Lace Mirage','Plum Reverie','Midnight Orchid',
    'Velvet Ember','Wicked Rose','Hush Parlour','Sapphire Hush'
  ];
  chosen text;
  attempt int;
BEGIN
  FOR r IN SELECT id, event_id FROM public.rsvps WHERE entry_phrase IS NULL ORDER BY created_at LOOP
    chosen := NULL;
    attempt := 0;
    FOR chosen IN SELECT p FROM unnest(phrases) AS p ORDER BY random() LOOP
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.rsvps WHERE event_id = r.event_id AND entry_phrase = chosen
      );
      chosen := NULL;
    END LOOP;
    IF chosen IS NULL THEN
      chosen := phrases[1 + floor(random() * array_length(phrases,1))::int];
      LOOP
        attempt := attempt + 1;
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.rsvps WHERE event_id = r.event_id AND entry_phrase = chosen || ' ' || attempt
        );
      END LOOP;
      chosen := chosen || ' ' || attempt;
    END IF;
    UPDATE public.rsvps SET entry_phrase = chosen WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.rsvps ALTER COLUMN entry_phrase SET NOT NULL;
