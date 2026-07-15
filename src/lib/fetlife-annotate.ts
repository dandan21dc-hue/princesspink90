/**
 * Live-preview annotation for the admin Settings FetLife handle input.
 * Splits the raw input string into segments so the UI can render each
 * character in one of three roles:
 *
 * - `kept`     — will end up in the normalized handle sent to the server.
 * - `stripped` — will be removed by `normalizeFetlifeHandle` (leading /
 *                trailing whitespace, `https://fetlife.com/` prefix, leading
 *                `@`/`/`, path / query / fragment).
 * - `invalid`  — kept by the normalizer BUT fails the handle rules (control
 *                character, disallowed character, or over the length cap).
 *
 * The union of segment texts always exactly equals the raw input, so the
 * UI can safely render them concatenated without losing or reordering any
 * character. This is a pure helper with no DOM / React dependency — see
 * `fetlife-annotate.test.ts` for its full behavioral contract.
 */

import { FETLIFE_HANDLE_MAX } from "./settings.functions";

export type FetlifeAnnotationKind = "kept" | "stripped" | "invalid";
export type FetlifeAnnotationSegment = {
  text: string;
  kind: FetlifeAnnotationKind;
};

const FETLIFE_HANDLE_CHAR_RE = /^[A-Za-z0-9_-]$/;
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;
const URL_PREFIX_RE = /^https?:\/\/(?:www\.)?fetlife\.com\/+/i;

function push(
  segments: FetlifeAnnotationSegment[],
  kind: FetlifeAnnotationKind,
  text: string,
) {
  if (!text) return;
  const last = segments[segments.length - 1];
  if (last && last.kind === kind) {
    last.text += text;
    return;
  }
  segments.push({ kind, text });
}

export function annotateFetlifeHandleInput(
  raw: string | null | undefined,
): FetlifeAnnotationSegment[] {
  const s = raw ?? "";
  const segments: FetlifeAnnotationSegment[] = [];
  if (s === "") return segments;

  let cursor = 0;

  // 1. Leading whitespace → stripped.
  const leadingWs = s.match(/^\s+/);
  if (leadingWs) {
    push(segments, "stripped", leadingWs[0]);
    cursor += leadingWs[0].length;
  }

  let rest = s.slice(cursor);

  // 2. URL prefix (https?://[www.]fetlife.com/+) → stripped.
  const urlPrefix = rest.match(URL_PREFIX_RE);
  if (urlPrefix) {
    push(segments, "stripped", urlPrefix[0]);
    cursor += urlPrefix[0].length;
    rest = s.slice(cursor);
  }

  // 3. Split off path / query / fragment — everything from the first
  //    `/`, `?`, or `#` onwards is dropped by the normalizer.
  const sepIdx = rest.search(/[/?#]/);
  const headEnd = sepIdx === -1 ? rest.length : sepIdx;
  const head = rest.slice(0, headEnd);
  const tail = rest.slice(headEnd);

  // 4. Within the head, leading `@` / `/` decorations → stripped. (The
  //    `/` case is already covered by step 3 for interior slashes; this
  //    handles a lone leading `@`.)
  const leadDecor = head.match(/^[@/]+/);
  const headAfterDecor = leadDecor ? head.slice(leadDecor[0].length) : head;
  if (leadDecor) push(segments, "stripped", leadDecor[0]);

  // 5. Trailing whitespace within the head → stripped.
  const trailWsMatch = headAfterDecor.match(/\s+$/);
  const trailingWs = trailWsMatch ? trailWsMatch[0] : "";
  const kept = trailingWs
    ? headAfterDecor.slice(0, headAfterDecor.length - trailingWs.length)
    : headAfterDecor;

  // 6. Classify each character of `kept` — this is what the server will
  //    see. Anything outside [A-Za-z0-9_-], any control char, or anything
  //    past FETLIFE_HANDLE_MAX is marked invalid.
  for (let i = 0; i < kept.length; i++) {
    const ch = kept[i];
    if (
      CONTROL_CHAR_RE.test(ch) ||
      !FETLIFE_HANDLE_CHAR_RE.test(ch) ||
      i >= FETLIFE_HANDLE_MAX
    ) {
      push(segments, "invalid", ch);
    } else {
      push(segments, "kept", ch);
    }
  }

  if (trailingWs) push(segments, "stripped", trailingWs);
  if (tail) push(segments, "stripped", tail);

  return segments;
}
