/**
 * Demo ticket seeder — creates 100 realistic support tickets directly via
 * Prisma so we can see sorting and filtering across all fields (status,
 * category, requester, subject, createdAt).
 *
 * Run against the test DB:
 *   cd backend && bun --env-file=.env.test run src/seed-demo-tickets.ts
 *
 * Run against the dev DB (omit the env-file flag):
 *   cd backend && bun run src/seed-demo-tickets.ts
 *
 * The script is idempotent within a single run but will add more rows if run
 * again (messageIds are timestamped so they won't collide with prior runs).
 */

import { prisma } from "./prisma.ts";
import { TicketStatus, TicketCategory } from "./generated/prisma/enums.ts";
import { aiAgentId } from "./tickets/ai-agent.ts";

// ─── Data pools ──────────────────────────────────────────────────────────────

const students: Array<{ name: string; email: string }> = [
  { name: "Alice Nguyen",      email: "alice.nguyen@students.edu" },
  { name: "Ben Carter",        email: "ben.carter@students.edu" },
  { name: "Chloe Ramirez",     email: "chloe.ramirez@students.edu" },
  { name: "David Kim",         email: "david.kim@students.edu" },
  { name: "Elena Osei",        email: "elena.osei@students.edu" },
  { name: "Finn Larsson",      email: "finn.larsson@students.edu" },
  { name: "Grace Patel",       email: "grace.patel@students.edu" },
  { name: "Hiro Tanaka",       email: "hiro.tanaka@students.edu" },
  { name: "Isabel Costa",      email: "isabel.costa@students.edu" },
  { name: "James Okafor",      email: "james.okafor@students.edu" },
  { name: "Kira Müller",       email: "kira.mueller@students.edu" },
  { name: "Liam Dubois",       email: "liam.dubois@students.edu" },
  { name: "Mia Torres",        email: "mia.torres@students.edu" },
  { name: "Noah Andersen",     email: "noah.andersen@students.edu" },
  { name: "Olivia Smith",      email: "olivia.smith@students.edu" },
  { name: "Paulo Ferreira",    email: "paulo.ferreira@students.edu" },
  { name: "Quinn Hughes",      email: "quinn.hughes@students.edu" },
  { name: "Riya Sharma",       email: "riya.sharma@students.edu" },
  { name: "Sam Johansson",     email: "sam.johansson@students.edu" },
  { name: "Tanya Williams",    email: "tanya.williams@students.edu" },
];

// 25 general, 25 technical, 25 refund, 25 uncategorised (null)
const tickets: Array<{
  subject: string;
  body: string;
  category: TicketCategory | null;
  status: TicketStatus;
}> = [
  // ── General (25) ────────────────────────────────────────────────────────────
  {
    subject: "Accommodation request for upcoming exam week",
    body: "Hi, I have a learning disability and need extended time for my final exam next month. Could you please confirm the accommodation process and the deadline for submitting the form?",
    category: TicketCategory.general,
    status: TicketStatus.open,
  },
  {
    subject: "Advisor appointment — cannot find booking link",
    body: "I tried to book an appointment with my academic advisor but the link in my student portal keeps returning a 404 error. Could someone send me the correct URL?",
    category: TicketCategory.general,
    status: TicketStatus.resolved,
  },
  {
    subject: "Campus ID card lost — replacement procedure",
    body: "I lost my campus ID card yesterday. What do I need to do to get a replacement? Is there a fee involved?",
    category: TicketCategory.general,
    status: TicketStatus.open,
  },
  {
    subject: "Change of major — required paperwork",
    body: "I would like to change my major from Business Administration to Computer Science. Could you outline the steps and any forms I need to fill out?",
    category: TicketCategory.general,
    status: TicketStatus.resolved,
  },
  {
    subject: "Commencement ceremony — guest ticket allocation",
    body: "I graduate this spring and would like to know how many guest tickets I'm entitled to and when they will become available to claim.",
    category: TicketCategory.general,
    status: TicketStatus.open,
  },
  {
    subject: "Course withdrawal deadline extension request",
    body: "Due to a family medical emergency I was unable to withdraw from my course before the deadline. I am requesting a retroactive withdrawal. I can provide supporting documentation.",
    category: TicketCategory.general,
    status: TicketStatus.open,
  },
  {
    subject: "Dean's list certificate — how to download",
    body: "I made the Dean's List last semester but cannot find how to download or print the official certificate from the student portal. Could you point me to the right page?",
    category: TicketCategory.general,
    status: TicketStatus.closed,
  },
  {
    subject: "Disability services — parking permit renewal",
    body: "My disability parking permit expired last week. I've already renewed my state-issued placard — do I need to resubmit documentation to the campus disability office as well?",
    category: TicketCategory.general,
    status: TicketStatus.open,
  },
  {
    subject: "Email alias change after legal name update",
    body: "I recently had my legal name changed. I would like to update my official university email address to reflect my new name. What is the process?",
    category: TicketCategory.general,
    status: TicketStatus.resolved,
  },
  {
    subject: "Enrollment verification letter for apartment lease",
    body: "My landlord needs an official enrollment verification letter showing I'm a full-time student for the upcoming semester. How do I request one and how long does it take?",
    category: TicketCategory.general,
    status: TicketStatus.resolved,
  },
  {
    subject: "Final exam timetable conflict with work schedule",
    body: "My final exams clash with my mandatory work shifts. Is there a process for requesting an alternative exam time? My employer cannot adjust my schedule.",
    category: TicketCategory.general,
    status: TicketStatus.open,
  },
  {
    subject: "Graduate certificate program — admission status",
    body: "I applied to the Graduate Certificate in Data Analytics six weeks ago and haven't heard back. Could you check on my application status?",
    category: TicketCategory.general,
    status: TicketStatus.open,
  },
  {
    subject: "Housing lottery — application not showing in portal",
    body: "I submitted my housing lottery application last Tuesday but it does not appear under 'My Applications' in the portal. Did it go through?",
    category: TicketCategory.general,
    status: TicketStatus.resolved,
  },
  {
    subject: "International student study permit — letter of support",
    body: "My study permit renewal requires a letter from the university confirming my enrollment and expected completion date. How do I request this?",
    category: TicketCategory.general,
    status: TicketStatus.open,
  },
  {
    subject: "Leave of absence — returning student process",
    body: "I took a one-semester leave of absence and would like to return next fall. What steps do I need to take to be re-activated and ensure my financial aid continues?",
    category: TicketCategory.general,
    status: TicketStatus.open,
  },
  {
    subject: "Library fine dispute — returned book before deadline",
    body: "I have a $12 library fine for a book that I'm certain I returned before the due date. I have a photo of the return slot timestamp. How do I dispute this charge?",
    category: TicketCategory.general,
    status: TicketStatus.closed,
  },
  {
    subject: "Meal plan downgrade for second semester",
    body: "I'd like to downgrade my meal plan from the Gold tier to Silver for next semester. Is this possible during the open-change window?",
    category: TicketCategory.general,
    status: TicketStatus.resolved,
  },
  {
    subject: "Mentorship program — application not received",
    body: "I submitted my mentorship program application through the online form on the 3rd but haven't received a confirmation email. Could you confirm receipt?",
    category: TicketCategory.general,
    status: TicketStatus.open,
  },
  {
    subject: "Official transcript request — expedited processing",
    body: "I need an official transcript sent to a graduate school by their deadline in two weeks. Is expedited processing available and what is the additional fee?",
    category: TicketCategory.general,
    status: TicketStatus.resolved,
  },
  {
    subject: "Part-time enrollment status and financial aid impact",
    body: "I need to drop to part-time (9 credits) next semester for health reasons. How will this affect my scholarship and federal financial aid?",
    category: TicketCategory.general,
    status: TicketStatus.open,
  },
  {
    subject: "Quiet study room booking — system error",
    body: "Every time I try to book a quiet study room through the library booking system I get a server error after selecting the time slot. Can someone look into this?",
    category: TicketCategory.general,
    status: TicketStatus.open,
  },
  {
    subject: "Residency reclassification — in-state tuition eligibility",
    body: "I've lived in the state for over two years now and believe I qualify for in-state tuition. Could you send me the reclassification form and list of required documents?",
    category: TicketCategory.general,
    status: TicketStatus.open,
  },
  {
    subject: "Scholarship renewal — GPA requirement clarification",
    body: "My scholarship requires a 3.0 GPA but last semester I got a 2.98. The difference is due to a grade I'm appealing. Will the renewal be paused while the appeal is pending?",
    category: TicketCategory.general,
    status: TicketStatus.open,
  },
  {
    subject: "Transfer credit evaluation — pending for 8 weeks",
    body: "I submitted my transfer credit evaluation request eight weeks ago. The portal still shows 'Pending Review'. Can someone give me an update on when this will be completed?",
    category: TicketCategory.general,
    status: TicketStatus.open,
  },
  {
    subject: "Volunteer hours verification for scholarship requirement",
    body: "My scholarship requires 40 hours of community service per year. I've completed mine and need an official letter from the volunteer coordinator. How do I get this issued?",
    category: TicketCategory.general,
    status: TicketStatus.resolved,
  },

  // ── Technical (25) ──────────────────────────────────────────────────────────
  {
    subject: "Canvas assignment submission portal not loading",
    body: "I've been trying to submit my assignment on Canvas for the past hour but the submission page keeps loading indefinitely. The deadline is tomorrow. Please help urgently.",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Course registration system — add/drop page crashes on submit",
    body: "Whenever I click 'Submit' on the add/drop page during registration, the browser freezes and I get a white screen. I've tried Chrome, Firefox, and Edge with the same result.",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Duo Mobile push notifications not arriving",
    body: "My Duo Mobile app stopped receiving push notifications three days ago. I've re-enrolled the device and reinstalled the app but the issue persists. I'm locked out of many university services.",
    category: TicketCategory.technical,
    status: TicketStatus.resolved,
  },
  {
    subject: "Email account storage quota exceeded",
    body: "I received a warning that my university email storage is 99% full. I cannot receive new emails. I've deleted what I can but there doesn't seem to be a way to free up more space. Can the quota be increased?",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Final grade not appearing on transcript",
    body: "The grade for COMP 3820 was submitted by my professor two weeks ago, but it still shows 'In Progress' on my official transcript. This is affecting my job application.",
    category: TicketCategory.technical,
    status: TicketStatus.resolved,
  },
  {
    subject: "Gradebook discrepancy — midterm score incorrect",
    body: "My midterm score in the gradebook shows 62/100 but I received my graded paper back with 78/100. I've spoken to my professor who confirms the 78 but hasn't been able to fix it in the system.",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Lab software licence — MATLAB not activating",
    body: "I installed MATLAB using the student licence key provided by the IT portal, but the activation fails with error code R2024b-12. I've tried on two different computers.",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Learning management system — lecture videos not playing",
    body: "All recorded lecture videos in my BIO 2010 course now show a black screen with no audio. Other courses seem fine. This started after last week's LMS update.",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Multi-factor authentication backup codes not working",
    body: "I lost my phone and am trying to use my MFA backup codes to regain access to my university account. The codes I generated and printed were rejected. Please help.",
    category: TicketCategory.technical,
    status: TicketStatus.resolved,
  },
  {
    subject: "Network — campus Wi-Fi disconnects every 30 minutes",
    body: "In my dormitory (East Hall, room 312) the campus Wi-Fi drops every 30 minutes exactly and takes about 2 minutes to reconnect. This makes online exams very stressful.",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Online exam — Proctorio extension blocked by browser",
    body: "I need to install the Proctorio browser extension for my upcoming online exam but my managed laptop blocks extension installs. The exam is in 48 hours.",
    category: TicketCategory.technical,
    status: TicketStatus.resolved,
  },
  {
    subject: "Password reset email never arrives",
    body: "I requested a password reset three times today and the email never arrives. I've checked spam and my junk folder. My university email domain is correct.",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Portal — student account locked after failed logins",
    body: "I mistyped my password several times and now my account is locked. I cannot complete my course registration which closes tomorrow. Please unlock it urgently.",
    category: TicketCategory.technical,
    status: TicketStatus.resolved,
  },
  {
    subject: "Print credit balance not updating after top-up",
    body: "I added $20 to my print credit account an hour ago via the web portal. The payment went through on my bank statement but my balance still shows the old amount.",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Remote desktop — VPN connects but RDP times out",
    body: "I can connect to the campus VPN successfully but when I try to RDP into the lab machines for my CS course the connection times out after about 10 seconds.",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Research data portal — upload limit too low",
    body: "I'm trying to upload my dissertation data archive (14 GB) to the research data portal but the file upload UI refuses anything over 5 GB. Is there an alternative upload method?",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Screen reader compatibility — course materials PDF",
    body: "The PDFs for HIST 3400 are not compatible with my screen reader (NVDA). The text is not selectable and appears to be a scanned image. Could the instructor provide accessible versions?",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Single sign-on — redirect loop on library database",
    body: "When I click 'Access via University Login' on the JSTOR and ProQuest databases I get stuck in an infinite redirect loop. It was working fine last week.",
    category: TicketCategory.technical,
    status: TicketStatus.resolved,
  },
  {
    subject: "Student portal — schedule page shows wrong semester",
    body: "My course schedule page is displaying last semester's timetable instead of the current one, even though I'm enrolled in new courses. My professors confirm I'm in the right sections.",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Timetable clash — system allowed double-booking",
    body: "The course registration system allowed me to enrol in two sections that overlap on Tuesday from 11:00–12:30. I noticed the conflict after the fact. Which section is correct?",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Two-step verification — phone number no longer in use",
    body: "My two-step verification is sending codes to an old phone number I no longer have access to. I need to update the number but can't get in without the code. Please help.",
    category: TicketCategory.technical,
    status: TicketStatus.resolved,
  },
  {
    subject: "University app — push notifications not working on Android",
    body: "The official university mobile app has not sent any push notifications since I upgraded to Android 15. I've checked all notification permissions and battery optimisation settings.",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Video conferencing — Zoom not recognising university licence",
    body: "When I sign into Zoom with my university SSO credentials it signs me in as a free Basic account instead of the licensed account. My course seminars require features only available on the licensed plan.",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Webcam not detected during online proctored exam",
    body: "I sat a proctored exam yesterday and the proctoring software reported my webcam was not detected for the last 20 minutes of the exam. My webcam was functioning and I have recording evidence.",
    category: TicketCategory.technical,
    status: TicketStatus.open,
  },
  {
    subject: "Wi-Fi — eduroam credential update causing connection failures",
    body: "After the forced eduroam credential update last Monday I can no longer connect to eduroam on my laptop. My phone connects fine using the new credentials.",
    category: TicketCategory.technical,
    status: TicketStatus.resolved,
  },

  // ── Refund (25) ─────────────────────────────────────────────────────────────
  {
    subject: "Activity fee refund — withdrew before semester started",
    body: "I withdrew from the university before the semester start date. The activity fee of $185 was charged to my account. I'd like to request a full refund.",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },
  {
    subject: "Books purchased in error — wrong edition",
    body: "I purchased both volumes of the required textbook through the university bookstore, then discovered the professor updated the syllabus to the newer edition. Can I return these for a refund?",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },
  {
    subject: "Campus bus pass — refund after car permit issued",
    body: "I bought a semester bus pass but then obtained a parking permit from the university motor pool. I've only used the bus pass once. Is a prorated refund available?",
    category: TicketCategory.refund,
    status: TicketStatus.resolved,
  },
  {
    subject: "Conference registration fee — event cancelled by university",
    body: "The annual student leadership conference was cancelled by the university last week. I paid the $60 registration fee in advance. When will this be refunded?",
    category: TicketCategory.refund,
    status: TicketStatus.resolved,
  },
  {
    subject: "Course drop refund — medical withdrawal documentation submitted",
    body: "I withdrew from two courses mid-semester due to a hospitalisation. I've submitted all required medical documentation to the registrar. What is the timeline for the tuition refund?",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },
  {
    subject: "Duplicate payment on student account — two charges for one course",
    body: "My student account shows two identical charges of $1,340 for ECON 2200. I only enrolled in this course once. Please investigate and issue a refund for the duplicate.",
    category: TicketCategory.refund,
    status: TicketStatus.resolved,
  },
  {
    subject: "Equipment deposit refund — lab gear returned in full",
    body: "I returned all borrowed lab equipment at the end of the semester and received a receipt from the lab technician. However, my $150 equipment deposit has not been credited back. It has been six weeks.",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },
  {
    subject: "Field trip fee — trip did not run due to low enrolment",
    body: "The field trip for GEOG 3150 was cancelled because fewer than 10 students signed up. I paid the $75 field trip fee. Please arrange a refund.",
    category: TicketCategory.refund,
    status: TicketStatus.resolved,
  },
  {
    subject: "Graduation application fee — programme not accredited",
    body: "I applied to graduate but later discovered the programme I completed is not yet accredited. I've deferred graduation. Can the $95 application fee be refunded?",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },
  {
    subject: "Health insurance waiver approved — premium refund request",
    body: "I submitted proof of equivalent private health insurance and the waiver was approved. However, the full health insurance premium of $780 was still charged to my account. Please issue a refund.",
    category: TicketCategory.refund,
    status: TicketStatus.resolved,
  },
  {
    subject: "Housing deposit — application withdrawn within cooling-off period",
    body: "I submitted and then withdrew my housing application within the 72-hour cooling-off period as stated in the terms. The $300 deposit has not been returned. Please advise.",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },
  {
    subject: "Internship course credit — company placement fell through",
    body: "I paid the credit hour fees for an internship-for-credit course, but my placement company withdrew the offer a week before the semester began. Can I receive a refund for those credits?",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },
  {
    subject: "Late registration fee — system error caused the delay",
    body: "I was charged a $50 late registration fee despite attempting to register on time. I have screenshots showing a server error prevented me from completing registration until the next day.",
    category: TicketCategory.refund,
    status: TicketStatus.resolved,
  },
  {
    subject: "Meal plan balance — unused credit after graduation",
    body: "I graduated last month and have $340 in unused meal plan credit. The terms state this is refundable to graduating students. Please process the refund to my bank account on file.",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },
  {
    subject: "Overpayment on tuition — financial aid adjustment",
    body: "After my financial aid package was revised my account shows a credit balance of $450. How do I request this overpayment be refunded rather than held as a credit?",
    category: TicketCategory.refund,
    status: TicketStatus.resolved,
  },
  {
    subject: "Parking permit — vehicle sold, permit returned unused",
    body: "I sold my car and returned my annual parking permit to the motor pool with 7 months remaining. The prorated refund policy in the terms should give me back approximately $175. When will it be processed?",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },
  {
    subject: "Printing credit — balance lost after account deactivation",
    body: "My student account was deactivated after graduation. I still had $18.50 in printing credit that I was unable to use. Please refund this to my registered payment method.",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },
  {
    subject: "Recreation centre membership — injury prevents use",
    body: "I purchased a full-year recreation centre membership but sustained a serious knee injury in October that prevents me from using the facility. I have a doctor's note. Can I get a prorated refund?",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },
  {
    subject: "Returned cheque fee dispute — bank processing delay",
    body: "I was charged a $35 returned cheque fee for a payment that was returned due to a well-documented bank processing delay, not insufficient funds. Please waive this fee.",
    category: TicketCategory.refund,
    status: TicketStatus.resolved,
  },
  {
    subject: "Study abroad deposit — programme cancelled by provider",
    body: "The study abroad provider cancelled the summer programme I enrolled in. I paid a $500 deposit. The provider says refunds are handled by the university's international office.",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },
  {
    subject: "Technology fee refund — fully online student",
    body: "I am a fully online student and have never set foot on campus. I was charged the on-campus technology fee of $120. Online students should be exempt. Please refund this.",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },
  {
    subject: "Test centre booking fee — exam deferred by department",
    body: "I paid $25 to book a test centre slot for my PSYC 4000 exam. The department subsequently moved the exam online, making the booking unnecessary. Please refund the booking fee.",
    category: TicketCategory.refund,
    status: TicketStatus.resolved,
  },
  {
    subject: "Thesis binding fee — submitted electronically instead",
    body: "I was charged the mandatory thesis binding fee of $55 but the graduate school approved my request to submit electronically. The binding is therefore unnecessary. Please refund the fee.",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },
  {
    subject: "Tuition instalment plan fee — paid in full early",
    body: "I enrolled in the three-instalment tuition payment plan but received a bursary and paid the full balance early. Am I entitled to a refund of any portion of the $45 administration fee?",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },
  {
    subject: "Workshop registration — attended but certificate not issued",
    body: "I attended the Research Methods workshop and paid the $30 registration fee, but I haven't received my certificate of completion. Either issue the certificate or refund the fee.",
    category: TicketCategory.refund,
    status: TicketStatus.open,
  },

  // ── Uncategorised / null (25) ────────────────────────────────────────────────
  {
    subject: "Alumni email access after graduation",
    body: "I graduated last spring. Do I retain access to my university email address, and if so for how long? I have important academic contacts there I need to preserve.",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Blood drive sign-up confirmation not received",
    body: "I signed up for the on-campus blood drive next Thursday through the student union portal but haven't received a confirmation email. Is my slot reserved?",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Campus safety — broken lighting on east path",
    body: "Three streetlights on the path between the science block and the east parking garage have been out for over a week. The path is very dark and feels unsafe at night.",
    category: null,
    status: TicketStatus.resolved,
  },
  {
    subject: "Career fair registration — employer list query",
    body: "Can you tell me whether any data science companies are registered for the spring career fair? I want to know whether it's worth attending before I take a day off work.",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Club recognition — new student organisation application",
    body: "A group of us would like to start a Robotics Club. I submitted the new student organisation recognition form three weeks ago but haven't heard anything. What is the expected processing time?",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Counselling services — waitlist update request",
    body: "I was placed on the counselling services waitlist six weeks ago. I'm just asking for an update on my position and an estimated wait time. I understand services are in high demand.",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Dining hall hours — holiday schedule",
    body: "Are the dining halls open during the reading week holiday? If so, what are the modified hours? The website only shows the regular semester schedule.",
    category: null,
    status: TicketStatus.resolved,
  },
  {
    subject: "Emergency bursary — unexpected financial hardship",
    body: "My father was recently laid off and my family can no longer contribute to my living expenses. I'm struggling to pay rent and buy groceries. I'd like to apply for the emergency bursary.",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Faculty advisor change request",
    body: "I would like to change my faculty advisor from Prof. Harrison to Prof. Yamamoto, who specialises in my thesis topic. What is the formal process for this?",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Food allergy accommodation in residence dining",
    body: "I have a severe nut allergy and need to ensure safe meal options are available in my residence dining hall. Can I meet with the dining services nutritionist?",
    category: null,
    status: TicketStatus.resolved,
  },
  {
    subject: "Graduation photo session — rescheduling request",
    body: "I missed my assigned graduation photo session last Tuesday due to a sudden illness. Is there any way to reschedule before the commencement deadline?",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Health centre prescription renewal",
    body: "My repeat prescription for a long-term medication is about to run out. Can the campus health centre renew it, or do I need to visit my GP off campus?",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "International orientation — date and location query",
    body: "I'm an incoming international student. I saw that there's a separate international orientation but the welcome email doesn't mention the venue. Where should I go?",
    category: null,
    status: TicketStatus.resolved,
  },
  {
    subject: "Lost and found — laptop reported missing in library",
    body: "I left my laptop in the second-floor study area of the main library yesterday afternoon. I've checked with the front desk and they don't have it. Has anyone turned it in?",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Mental health day — attendance policy clarification",
    body: "I needed to take an unplanned day off for my mental health. The course attendance policy is unclear on whether mental health absences are treated the same as medical absences.",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Noise complaint — neighbouring room in residence",
    body: "My neighbour in the room next door plays music loudly until 2–3 am on weeknights. I've knocked and asked them to lower the volume twice but it continues. Please escalate.",
    category: null,
    status: TicketStatus.closed,
  },
  {
    subject: "On-campus job listing — application feedback request",
    body: "I applied for the library assistant position last month and was not selected. I'd really appreciate any feedback on my application or interview to help me improve.",
    category: null,
    status: TicketStatus.resolved,
  },
  {
    subject: "Parking — appeal for ticket received during official move-in",
    body: "I received a parking fine while unloading my belongings during the official move-in day. I was parked in the designated move-in zone. Please review and cancel the fine.",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Peer tutoring programme — sign-up not working",
    body: "The peer tutoring sign-up form on the academic support website gives a 'Form closed' message but the academic calendar shows sign-ups should still be open. Please advise.",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Research ethics approval — timeline for review board",
    body: "I submitted my research ethics application for my undergraduate thesis on 2 March. The website says reviews take 4–6 weeks. It's been 9 weeks. Can you provide a status update?",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Shuttle bus route — temporary stop removal query",
    body: "The shuttle stop closest to my off-campus accommodation appears to have been removed without notice. Is this permanent? How should I get to campus now?",
    category: null,
    status: TicketStatus.resolved,
  },
  {
    subject: "Student union election — candidate eligibility question",
    body: "I'd like to run for Vice President of the student union in the spring election. I'm in my second year. Can you confirm whether second-year students are eligible to stand?",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Translation services — academic document in foreign language",
    body: "I need to submit an officially translated version of my secondary school transcript, which is in Portuguese. Does the university accept certified translations from any accredited translator?",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Vaccination record upload — portal not accepting PDF",
    body: "I'm trying to upload my vaccination records as required for on-campus housing but the portal rejects my PDF with 'unsupported file type'. The instructions say PDF is accepted.",
    category: null,
    status: TicketStatus.open,
  },
  {
    subject: "Writing centre appointment — no slots available",
    body: "Every single appointment slot at the writing centre is booked for the next three weeks. I have a major paper due in 10 days. Is there a drop-in option or a waitlist I can join?",
    category: null,
    status: TicketStatus.open,
  },
];

// ─── Seeding ──────────────────────────────────────────────────────────────────

// With --if-missing the script is a no-op when demo data is already present, so
// it can be run unconditionally from a bootstrap step without stacking another
// 100 rows on every invocation. The probe is a closed ticket: nothing else in
// the app creates one (the inbound webhook and the auto-resolve worker only ever
// produce new/processing/open/resolved), so its presence means this seeder ran.
if (process.argv.includes("--if-missing")) {
  const existing = await prisma.ticket.count({
    where: { status: TicketStatus.closed },
  });
  if (existing > 0) {
    console.log(
      `Demo tickets already present (${existing} closed) — nothing to do.`,
    );
    await prisma.$disconnect();
    process.exit(0);
  }
}

const ts = Date.now();

// Assigned to the AI-resolved rows below, matching what the real auto-resolve
// worker leaves behind. Null when the AI user hasn't been seeded.
const aiId = await aiAgentId();

for (const [i, t] of tickets.entries()) {
  const student = students[i % students.length];
  const suffix = `${ts}-${i}`;

  // Space the createdAt values 4 hours apart so newest-first ordering is
  // clearly visible in the UI (100 tickets × 4 h = ~17 days of history).
  const createdAt = new Date(ts - (tickets.length - i) * 4 * 60 * 60 * 1000);

  // A resolved ticket needs a resolvedAt or the dashboard's average
  // time-to-resolve has nothing to average. Spread deterministically over
  // 45 min–9 h so the figure looks like real support work rather than a
  // constant, and every third one is attributed to the AI so the
  // resolved-by-AI metrics aren't a flat zero in a fresh dev database.
  const isResolved = t.status === TicketStatus.resolved;
  const resolvedAt = isResolved
    ? new Date(createdAt.getTime() + ((i % 12) + 1) * 45 * 60 * 1000)
    : null;
  const byAi = isResolved && i % 3 === 0;

  await prisma.ticket.create({
    data: {
      subject: t.subject,
      requesterEmail: student.email,
      requesterName: student.name,
      status: t.status,
      category: t.category,
      createdAt,
      updatedAt: resolvedAt ?? createdAt,
      resolvedAt,
      ...(byAi && {
        aiResolvedAt: resolvedAt,
        aiConfidence: 0.86 + ((i % 5) * 0.02),
        aiDecision: "The knowledge base fully covers this request.",
        assignedToId: aiId,
      }),
      messages: {
        create: {
          direction: "inbound",
          fromEmail: student.email,
          fromName: student.name,
          body: t.body,
          messageId: `<demo-${suffix}@mail.example.com>`,
          createdAt,
        },
      },
    },
  });

  console.log(`[${i + 1}/100] Created: "${t.subject.slice(0, 60)}"`);
}

await prisma.$disconnect();
console.log("\nDone — 100 demo tickets created.");
