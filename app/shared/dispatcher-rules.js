// dispatcher-rules.js — LoadBoot standing rules, every carrier (bl_disp_0555, 15 Oct 2026).
// The words mirror app_private.disp_standing_rules_text() (the dispatcher brief e-mail, the thread system line and
// dispatcher_workspace_feed.rules read the SQL copy). This static copy is for CC screens that have no feed: the SOP
// dialog and the Dispatcher 360 rules card. Change both places together.
export const STANDING_RULES = [
  ['One intro call', 'Right after the assignment, call the carrier once on your LoadBoot line. Introduce yourself, walk them to Post your availability in their portal (30 seconds a day), and say it plainly: every load you hunt is matched to that post — no post, nothing to work.'],
  ['Never call for availability again', 'If the post goes stale the portal reminds the carrier. You post nothing until it is fresh, and you do not chase it by phone.'],
  ['Every carrier call has a reason', 'The phone asks before it dials. After the intro only the urgent reasons are allowed: pickup within 24 hours, an in-transit problem, a broker who needs an answer now, the carrier asked to be called. Everything else goes in the thread.'],
  ['Post only shortlisted loads', 'A load goes on the carrier’s board only when it fits the posted availability, the floor rate and the SOP — 100% shortlisted, one look to decide. The carrier accepts or declines in the portal.'],
  ['Accepted means your move', 'Call the broker, lock the rate, get the rate confirmation, log it. LoadBoot approves, then the driver moves.'],
];

// Where a dispatcher-posted load is, in one line for either side (mirrors app_private.disp_load_stage ball values).
export const BALL_LABEL = { carrier: 'Waiting on the carrier', dispatcher: 'Your move', broker: 'Waiting on the broker', loadboot: 'Waiting on LoadBoot', driver: 'Driver moving', done: 'Done', closed: 'Closed' };
