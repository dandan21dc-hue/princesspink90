CREATE OR REPLACE FUNCTION public.rsvps_assign_entry_phrase()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  IF NEW.entry_phrase IS NOT NULL AND btrim(NEW.entry_phrase) <> '' THEN
    RETURN NEW;
  END IF;

  -- Normalize blank to NULL for consistency downstream.
  NEW.entry_phrase := NULL;

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
$function$;