/**
 * Long-conversation seeder — appends 15 alternating replies to one ticket so
 * the detail page can be exercised against a realistic thread (scrolling,
 * direction badges, summarisation over a long history) rather than the single
 * message the demo seeder creates.
 *
 * Run against the dev DB:
 *   cd backend && bun run src/seed-ticket-conversation.ts
 *
 * Run against the test DB:
 *   cd backend && bun --env-file=.env.test run src/seed-ticket-conversation.ts
 *
 * Idempotent: it refuses to run twice against the same ticket. To reseed, drop
 * everything but the opening message first:
 *   DELETE FROM message
 *   WHERE "ticketId" = 97
 *     AND id <> (SELECT MIN(id) FROM message WHERE "ticketId" = 97);
 *
 * The dialogue is written for ticket 97 specifically ("Research ethics approval
 * — timeline for review board"), so pointing it at another ticket would seed a
 * coherent-looking thread about the wrong subject.
 */

import { prisma } from "./prisma.ts";
import type { Prisma } from "./generated/prisma/client.ts";

const TICKET_ID = 97;

// Mirrors the inbound-email webhook's cap (MAX_BODY_LENGTH in
// tickets/ingest-inbound-email.ts). Agent replies go through the reply endpoint
// instead, which has no cap, so this is asserted for inbound messages only.
const MAX_INBOUND_BODY_LENGTH = 1_000;

const MIN_LINES_PER_REPLY = 7;

// Greetings and sign-offs use first names, matching what the polish action
// produces — "Hi Olivia Smith," reads like a form letter.
function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

// One reply. `at` is an explicit timestamp rather than an offset so the dates
// referenced in the prose (the 24 July board meeting, the chase on the 29th)
// line up with when each message actually lands.
type Reply = {
  from: "agent" | "student";
  at: string;
  body: string;
};

function buildReplies(agent: string, student: string): Reply[] {
  return [
    {
      from: "agent",
      at: "2026-07-05T19:10:00.000Z",
      body: `Hi ${student},

Thanks for chasing this, and I'm sorry the wait has gone well past the published window.
I've located your application under reference REC-2026-0412, submitted on 2 March.
It cleared the completeness check on 9 March and has been queued for full board review since then.
The board received an unusually high volume this cycle, which is why the 4-6 week estimate has slipped.
I've flagged your file with the review board secretary and asked for a firm position in the queue.
I'll come back to you by the end of this week with either a review date or an explanation of the delay.
If your thesis timeline is at risk, tell me your submission deadline and I'll note it on the file.

Best regards,
${agent}`,
    },
    {
      from: "student",
      at: "2026-07-06T09:40:00.000Z",
      body: `Hi ${agent},

Thank you for looking into it and for the reference number.
My thesis is due for submission on 30 September, so the timing is genuinely tight.
My supervisor says I need a minimum of eight weeks of data collection to have anything usable.
Working back from 30 September, I need to start recruiting participants by mid-July at the latest.
Is there any form of provisional or conditional approval that would let me begin recruitment?
I'm happy to hold off on anything involving personal data until the full decision comes through.
If that isn't possible, I'd like to understand my options so I can talk to my supervisor.

Thanks,
${student}`,
    },
    {
      from: "agent",
      at: "2026-07-06T16:20:00.000Z",
      body: `Hi ${student},

I've had a response from the review board secretary this morning.
Provisional approval isn't something the board can issue for studies involving human participants.
Recruitment counts as participant contact, so it can't begin before a decision is recorded.
What I can do is have your file marked time-sensitive, which I've requested with your 30 September deadline attached.
The next full board meeting is on 24 July, and your application is on the draft agenda.
Outcomes are normally circulated within five working days of the meeting.
To strengthen the case, could you send me your supervisor's name and department?

Best regards,
${agent}`,
    },
    {
      from: "student",
      at: "2026-07-07T11:05:00.000Z",
      body: `Hi ${agent},

My supervisor is Dr. Priya Raman in the School of Psychology.
She's happy for you to contact her directly if the board needs confirmation of the timeline.
A 24 July meeting with outcomes by the end of that month leaves me about eight weeks exactly.
That works, but only if nothing else slips, so I'd rather plan for the worst case now.
What normally happens if the board attaches conditions to an approval?
I want to know whether that would cost me another full review cycle.
If it would, I need to tell my supervisor this week rather than in August.

Thanks,
${student}`,
    },
    {
      from: "agent",
      at: "2026-07-07T17:35:00.000Z",
      body: `Hi ${student},

Thanks — I've passed Dr. Raman's details to the secretary and she's been copied on the file note.
On conditions: most approvals here come back as "approved with minor conditions" rather than a flat approval.
Minor conditions are handled by the chair alone and do not go back to the full board.
Typical examples are wording changes to the participant information sheet or tightening a consent statement.
Once you submit the revised documents, the chair signs off within three to five working days.
Major conditions are rarer and do need a further board review, but those usually involve a change of study design.
Based on what I can see in your application, a further full review looks unlikely.

Best regards,
${agent}`,
    },
    {
      from: "student",
      at: "2026-07-08T20:15:00.000Z",
      body: `Hi ${agent},

That's reassuring, thank you.
One more question while I wait: can I start any of the preparatory work now?
I'm thinking of finalising the interview schedule and piloting the questions with coursemates.
The pilot wouldn't be part of the study data and I wouldn't record anything or keep notes about anyone involved.
I don't want to accidentally breach the policy by doing something that counts as recruitment.
If that isn't allowed either, I'll focus on the literature review instead.
Please let me know which side of the line this falls on.

Thanks,
${student}`,
    },
    {
      from: "agent",
      at: "2026-07-09T15:50:00.000Z",
      body: `Hi ${student},

Good question, and the distinction matters, so I checked with the secretary rather than guessing.
Piloting your questions with coursemates is not permitted if you are testing the instrument for the study.
That counts as data collection even when nothing is recorded and no notes are kept.
What you can do is prepare and finalise all your materials, including the interview schedule and consent forms.
You can also ask Dr. Raman to review the wording, since supervisory feedback is not participant contact.
Anything that does not involve a person responding to your study questions is fine.
I'd suggest scheduling the pilot immediately after approval so it doesn't delay you further.

Best regards,
${agent}`,
    },
    {
      from: "student",
      at: "2026-07-11T12:30:00.000Z",
      body: `Hi ${agent},

Understood, I'll leave the pilot until after the decision.
I met Dr. Raman yesterday and she raised a possibility I wanted to run past you.
She suggested splitting the study so the interviews and the follow-up survey are approved separately.
The idea is that the interview strand could start sooner while the survey strand is still under review.
Would that need a brand new application, or can it be handled as an amendment to the one already submitted?
I don't want to withdraw the current application and lose my place in the queue.
If it means starting again from scratch then it isn't worth doing.

Thanks,
${student}`,
    },
    {
      from: "agent",
      at: "2026-07-11T18:05:00.000Z",
      body: `Hi ${student},

You would not lose your place in the queue, so it's worth considering.
A change of this kind is handled as an amendment to REC-2026-0412, not as a new application.
You submit form REC-A through the same portal and reference the original application number.
Amendments filed before the board meets are considered alongside the original at the same sitting.
That means an amendment submitted in the next week would still be dealt with on 24 July.
If it arrives after the meeting it goes to the chair instead, which is faster but only for minor changes.
I'd get it in before 17 July to be safe, and I'm happy to check the form before you submit it.

Best regards,
${agent}`,
    },
    {
      from: "student",
      at: "2026-07-12T18:40:00.000Z",
      body: `Hi ${agent},

I've drafted the amendment and submitted it through the portal this afternoon.
The confirmation screen gave me reference REC-A-2026-0177 and said it was linked to the original application.
I split the study exactly as Dr. Raman suggested, with the interviews as strand one and the survey as strand two.
Strand one uses the consent form you already have and strand two has a separate short form attached.
Could you confirm it has reached the board and that it is attached to the right file?
The portal didn't send me an email receipt, which is why I'm asking.
I'd rather find out now than discover on 24 July that it went somewhere else.

Thanks,
${student}`,
    },
    {
      from: "agent",
      at: "2026-07-13T14:15:00.000Z",
      body: `Hi ${student},

Confirmed — REC-A-2026-0177 is on the system and correctly linked to REC-2026-0412.
The secretary has added both to the agenda for 24 July as a single item.
I've checked the attached documents and both consent forms are present and legible.
The missing email receipt is a known portal fault and is being tracked separately.
One small thing: your participant information sheet still gives the old single-strand description of the study.
It won't hold up the review, but the chair will almost certainly raise it as a minor condition.
If you send a corrected version before the meeting I'll add it to the file and save you a round trip.

Best regards,
${agent}`,
    },
    {
      from: "student",
      at: "2026-07-14T15:25:00.000Z",
      body: `Hi ${agent},

Thank you for catching that, I hadn't thought to update the information sheet.
I've rewritten the study description so it explains both strands and what participation involves in each.
I've also corrected the time commitment, since the survey adds about ten minutes for strand two participants.
The revised sheet is uploaded to the portal against the amendment reference.
Everything else in the pack is unchanged from what the board already has.
Is there anything else you'd suggest tidying up before the meeting on the 24th?
I'd rather fix it now than wait for it to come back as a condition.

Thanks,
${student}`,
    },
    {
      from: "agent",
      at: "2026-07-15T16:45:00.000Z",
      body: `Hi ${student},

The revised information sheet is on the file and reads well.
I've been through the rest of the pack and I don't think anything else needs changing before the 24th.
Your data management plan is more detailed than most we see at this level, which the board tends to like.
Your item is fourth on the agenda, so it should be reached before the lunch break.
You do not need to attend and there is nothing further for you to do beforehand.
Outcomes are circulated within five working days, so expect to hear by 31 July at the latest.
I'll email you as soon as the decision reaches me rather than waiting for the formal letter.

Best regards,
${agent}`,
    },
    {
      from: "student",
      at: "2026-07-29T20:10:00.000Z",
      body: `Hi ${agent},

It's now the 29th and I haven't had anything through, so I wanted to check in.
I know you said five working days and that we're still inside that window.
I'm asking early because recruitment materials need to go to the department office to be printed.
The office closes for two weeks from 8 August, so I need to get the order in before then.
If the decision lands this week I can still make that deadline comfortably.
Do you have any indication of what was decided at the meeting on the 24th?
Even an informal steer would help me decide whether to book the print slot now.

Thanks,
${student}`,
    },
    {
      from: "agent",
      at: "2026-07-30T09:15:00.000Z",
      body: `Hi ${student},

Good news — the board approved your application at the meeting on 24 July.
The outcome is "approved with minor conditions", which is what I expected from the earlier discussion.
There are two conditions, both on strand two: a clearer withdrawal statement and a named contact for data queries.
Neither goes back to the full board, so the chair can sign them off once you submit revised wording.
Turn those around this week and you'll have unconditional approval before the print office closes.
The formal letter and your approval certificate will follow by email within a few days.
You can begin recruitment for strand one as soon as the chair's sign-off is recorded.

Best regards,
${agent}`,
    },
  ];
}

// ─── Seeding ──────────────────────────────────────────────────────────────────

const ticket = await prisma.ticket.findUnique({
  where: { id: TICKET_ID },
  select: {
    id: true,
    subject: true,
    requesterName: true,
    requesterEmail: true,
    messages: {
      select: { direction: true, messageId: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    },
  },
});

if (!ticket) {
  console.error(
    `Ticket ${TICKET_ID} does not exist in this database. Seed the demo tickets first:\n  bun run src/seed-demo-tickets.ts`,
  );
  process.exit(1);
}

if (ticket.messages.length > 1) {
  console.error(
    `Ticket ${TICKET_ID} already has ${ticket.messages.length} messages — it looks seeded already. Nothing was written.\nTo reseed, delete everything but the opening message (see the header comment).`,
  );
  process.exit(1);
}

// Replies must alternate, so who goes first depends on who spoke last. The
// demo tickets end on the student's opening email, so the agent replies first.
const lastDirection = ticket.messages.at(-1)?.direction ?? "outbound";
if (lastDirection !== "inbound") {
  console.error(
    `Ticket ${TICKET_ID} ends with an outbound message, so starting with an agent reply would put two agent messages in a row. Nothing was written.`,
  );
  process.exit(1);
}

// Outbound messages are attributed to a real staff member, the way the reply
// endpoint does it. Prefer an agent; fall back to an admin, who is also staff.
const staff =
  (await prisma.user.findFirst({
    where: { deletedAt: null, role: "agent" },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: "asc" },
  })) ??
  (await prisma.user.findFirst({
    where: { deletedAt: null },
    select: { id: true, name: true, email: true },
    orderBy: { createdAt: "asc" },
  }));

if (!staff) {
  console.error(
    "No active staff user to attribute agent replies to. Create one first:\n  bun run db:seed",
  );
  process.exit(1);
}

const replies = buildReplies(
  firstNameOf(staff.name),
  firstNameOf(ticket.requesterName),
);

// Fail before writing anything rather than seeding a thread that violates the
// shape this script promises.
replies.forEach((reply, i) => {
  const lines = reply.body.split("\n").filter((line) => line.trim() !== "");
  if (lines.length < MIN_LINES_PER_REPLY) {
    throw new Error(
      `Reply ${i + 1} has ${lines.length} non-empty lines, fewer than the ${MIN_LINES_PER_REPLY} required.`,
    );
  }
  if (
    reply.from === "student" &&
    reply.body.length > MAX_INBOUND_BODY_LENGTH
  ) {
    throw new Error(
      `Reply ${i + 1} is ${reply.body.length} characters, over the ${MAX_INBOUND_BODY_LENGTH} the inbound webhook accepts.`,
    );
  }
  if (i > 0 && replies[i - 1]!.from === reply.from) {
    throw new Error(`Replies ${i} and ${i + 1} are both from the ${reply.from}.`);
  }
});

// Threading mirrors what the two real write paths produce: inbound messages
// carry the email headers ingest-inbound-email.ts records, while agent replies
// go out through the reply endpoint, which has no Message-Id to store yet.
const inboundHistory = ticket.messages
  .map((message) => message.messageId)
  .filter((id): id is string => id !== null);

const data: Prisma.MessageCreateManyInput[] = replies.map((reply, i) => {
  const createdAt = new Date(reply.at);

  if (reply.from === "agent") {
    return {
      ticketId: TICKET_ID,
      direction: "outbound",
      fromEmail: staff.email,
      fromName: staff.name,
      body: reply.body,
      sentById: staff.id,
      references: [],
      createdAt,
    };
  }

  const messageId = `<sim-${TICKET_ID}-${i + 1}@mail.example.com>`;
  const entry: Prisma.MessageCreateManyInput = {
    ticketId: TICKET_ID,
    direction: "inbound",
    fromEmail: ticket.requesterEmail,
    fromName: ticket.requesterName,
    body: reply.body,
    messageId,
    inReplyTo: inboundHistory.at(-1) ?? null,
    references: [...inboundHistory],
    createdAt,
  };
  inboundHistory.push(messageId);
  return entry;
});

const { count } = await prisma.message.createMany({ data });

const agentCount = replies.filter((r) => r.from === "agent").length;
console.log(
  `Seeded ${count} replies on ticket ${TICKET_ID} ("${ticket.subject}")\n` +
    `  ${agentCount} from ${staff.name} <${staff.email}>\n` +
    `  ${replies.length - agentCount} from ${ticket.requesterName} <${ticket.requesterEmail}>\n` +
    `  ${new Date(replies[0]!.at).toDateString()} → ${new Date(replies.at(-1)!.at).toDateString()}`,
);

await prisma.$disconnect();
