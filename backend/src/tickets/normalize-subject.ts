// Normalize an inbound email subject before it becomes a ticket subject. Strips
// leading reply/forward prefixes — "Re:", "RE:", "Fwd:", "FW:", including
// repeated and numbered variants like "Re[2]:" — and collapses runs of
// whitespace, so a threaded conversation doesn't accumulate "Re: Re: Fwd:" noise
// in the subject. Falls back to "(no subject)" when nothing meaningful remains.

const NO_SUBJECT = "(no subject)";

// One leading Re/Fwd/Fw token, optionally numbered (e.g. "Re[2]"), then a colon.
const REPLY_FORWARD_PREFIX = /^(?:re|fwd|fw)\s*(?:\[\d+\])?\s*:\s*/i;

export function normalizeSubject(raw: string): string {
  let subject = raw.trim();

  // Peel off stacked prefixes one at a time: "Re: Fwd: Hello" → "Hello".
  let previous: string;
  do {
    previous = subject;
    subject = subject.replace(REPLY_FORWARD_PREFIX, "").trim();
  } while (subject !== previous);

  // Collapse internal whitespace runs (incl. stray newlines) to single spaces.
  subject = subject.replace(/\s+/g, " ").trim();

  return subject === "" ? NO_SUBJECT : subject;
}
