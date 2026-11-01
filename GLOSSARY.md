# Chat-first production

The vocabulary of the chat that plans, quotes and runs a film for one person, and of the background work it starts. Terms the rest of the app already uses (Still, Clip, Library, Lifestyle, Director) keep their meaning here.

## People and money

**Owner**:
The person whose documents these are. One per desktop app; on Bay, one per signed-in visitor.
_Avoid_: User, account, tenant

**Quote**:
A free, priced proposal to run one spec of work. It is bound to a hash of that spec, is open until the Owner decides or 30 minutes pass, and is then approved, declined or expired. It is consumed by at most one Run.
_Avoid_: Estimate, price check, offer

**Approval**:
The Owner's yes on a Quote. It comes from a click on the card, a typed yes, an Allowance that covers it, or a cost of zero; nothing else, and never from the model.
_Avoid_: Confirmation, consent, sign-off

**Allowance**:
What an Owner has let the chat approve alone, per day, in the provider's own unit. It is zero until the Owner sets it. Part of it is reserved when a Run starts and settled when the result is known.
_Avoid_: Budget, quota, limit

**Audit entry**:
One row for one decision about money: who decided, what, on which Quote, for how much, and how it ended. Entries are only added, one list per day, and the Owner can export them.
_Avoid_: Log line, transaction, receipt

## Conversation

**Thread**:
One chat conversation: its Messages in order, its Turns, the Runs it started and the Assets the Owner dropped in.
_Avoid_: Conversation, session, chat

**Message**:
One API message kept exactly as sent or received, with its usage and request id. Once saved it is never edited.
_Avoid_: Entry, post

**Turn**:
One exchange with the model, from what started it to its answer. It moves from queued through streaming and running tools, may wait for the Owner, and ends completed, failed or interrupted. It is limited to 12 model calls.
_Avoid_: Round, request, step

**Trigger**:
What starts a Turn: the Owner's Message, an Event (a Run or Job changed), or a resume after the app found a Turn it had interrupted.
_Avoid_: Cause, wake-up

**Tool call**:
One request by the model to do something, checked against a schema and sorted into a class: read, text, local, propose or cancel. A tool call never spends; the most it can do is propose a Quote.
_Avoid_: Function call, action

**Asset**:
Something the Owner gave the chat to keep: a render image or a music bed.
_Avoid_: Attachment, upload, file

**Event**:
One numbered entry in a Thread's append-only feed. It shows the page what happened and wakes the model when something it started has changed.
_Avoid_: Notification, update, log line

## Background work

**Run**:
Work started from an approved Quote: a kind of film work, an ordered list of Steps, and a state that ends done, failed, stopped, or submit unknown. It carries on whether or not the Owner is looking.
_Avoid_: Job (taken), pipeline, workflow, batch

**Step**:
One stage of a Run: plan, cast, stills, direct, clips, cut, master or qc. It records its intent before any paid call, then the ids it made.
_Avoid_: Stage, phase, task (taken)

**Intent**:
A Step's note, written and saved before it asks a provider to do paid work. A Step that has an intent and no id afterwards may or may not have been charged, so it is never repeated.
_Avoid_: Reservation, pending marker

**Job**:
A planning document the app already keeps, which a Step points at: a Lifestyle job, a Director job, a Close-ups job or an Editing document.
_Avoid_: Run (taken), project

**Task**:
One piece of work done by a provider: an image, a video, a text answer or an ffmpeg operation.
_Avoid_: Job (taken), request

**Artifact**:
What a Run makes and the Owner keeps: a Still, a Clip, an Export (the master) or a QC report. Deleting a Thread never deletes one.
_Avoid_: Output, result, deliverable (a deliverable is a format of an Export)

**Deliverable**:
One format a master is made in: H.264 for web, HEVC 10-bit for review, ProRes 422 HQ master, or 9:16 for social. The Owner ticks the ones they want, and each one becomes its own Export.
_Avoid_: Output, preset, version

**QC report**:
What reading a finished master back found: loudness, true peak, frame count and the four colour tags, a pass or fail, and a sentence for each finding. It is kept with the Export it describes.
_Avoid_: Check result, validation, log

**Tick**:
One advance of every machine that only moves when someone asks it to, for one Owner, including the Runs.
_Avoid_: Poll, heartbeat

**Driver**:
The desktop timer that ticks the one Owner of the app every few seconds while the app is up. On Bay the page asks for the tick instead.
_Avoid_: Scheduler, worker, daemon

**Handoff**:
A link that opens a page with one result already selected, so a card in the chat can say "Open in Editing".
_Avoid_: Deep link, redirect

**Sidecar**:
An optional outside command-line editor, pinned to one version and one hash, that the app finds or downloads at the Owner's request. The app never needs it.
_Avoid_: Plugin, extension, dependency

**Sidecar status**:
What the app knows about one Sidecar right now: whether it is installed and where, the version found against the pinned one, whether they match, and one sentence on what to do next.
_Avoid_: Health, install state, version check

## Boundaries

- A Quote whose spec changes is a new Quote with a new hash. The old one is declined as superseded.
- A Run whose Step wrote an intent and crashed before any task id existed is submit unknown, and is never submitted again.
- Deleting a Thread keeps every Artifact.
- A Turn started by an Event while the Owner is typing still runs; the Owner's Message starts the Turn after it.
- A typed yes counts only as a real Message from the Owner that is newer than the latest open Quote.
