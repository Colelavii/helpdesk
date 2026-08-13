import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";

// DOMPurify parses into a real DOM, which Bun doesn't provide globally, so it
// gets a jsdom window. One window per process: building a JSDOM per email would
// dominate the cost of ingesting one. Keep jsdom current — DOMPurify's own docs
// warn that older versions carry XSS bugs, and that happy-dom is not safe here.
const purify = DOMPurify(new JSDOM("").window);

/**
 * Strips anything executable out of HTML that came from outside (an email's
 * text/html part): `<script>`, event-handler attributes, `javascript:` URLs, and
 * embedded frames. Relies on DOMPurify's default allow-list rather than a
 * hand-rolled one — email markup is too varied to enumerate safely.
 *
 * Returns `undefined` when nothing survives, so a payload that was *entirely*
 * markup doesn't get stored as an empty string, which would read as "the sender
 * supplied HTML" when they effectively didn't.
 */
export function sanitizeHtml(html: string): string | undefined {
  return purify.sanitize(html) || undefined;
}
