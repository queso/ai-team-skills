# PRD Template

Use this structure when creating new PRDs. Not every section is required for every PRD — scale to the size of the feature. A small bug fix doesn't need a full competitive analysis, but a new product area does.

---

```markdown
# PRD-NNNN: Feature Name

**Author:** [name]
**Date:** [date]
**Status:** Draft | In Review | Approved | In Progress | Shipped

## Problem Statement

What problem are we solving? Who has this problem? How do we know it's a real problem (data, user feedback, support tickets, business need)?

Keep this to 2-4 sentences. If you can't explain the problem concisely, you don't understand it well enough yet.

## Business Context

Why does this matter *now*? Connect to business goals:

- Revenue impact (new revenue, reduced churn, upsell)
- Cost reduction (support tickets, manual processes)
- Competitive pressure (market expectation, competitor feature)
- Strategic alignment (company OKRs, roadmap themes)

Include any relevant data: "We lose ~15% of trial users at the onboarding step" or "Support handles 50 tickets/week about this."

## Goals & Success Metrics

| Goal | Metric | Target |
|------|--------|--------|
| Reduce onboarding drop-off | Completion rate | 60% → 80% |
| Decrease support load | Tickets tagged "onboarding" | 50/week → 20/week |

Every goal must have a measurable outcome. If you can't measure it, reframe the goal until you can.

## User Stories

Who are the users and what do they need?

**As a** [persona], **I want** [capability] **so that** [outcome].

Examples:
- As a new user, I want guided setup so that I can start using the product without reading docs.
- As an admin, I want to see which team members haven't completed onboarding so that I can follow up.

## Scope

### In Scope
- Bullet list of what this PRD covers
- Be specific: "Email notifications for subscription expiry (7-day and 1-day warnings)"

### Out of Scope
- What we're explicitly *not* doing (and briefly why)
- "Native mobile push notifications (separate PRD, depends on mobile app timeline)"

Out of scope is just as important as in scope. It prevents scope creep and sets expectations.

## Requirements

### Functional Requirements

Numbered requirements that describe *what* the system should do:

1. The system shall send an email notification 7 days before subscription expiry.
2. The notification shall include the user's plan name, expiry date, and a renewal link.
3. Users who have already renewed shall not receive the notification.

Use "shall" for requirements (not "should" or "could" — those are ambiguous).

### Non-Functional Requirements

Performance, security, accessibility, scalability:

1. Notification emails shall be sent within 5 minutes of the scheduled time.
2. Email content shall not include sensitive account data (payment details, passwords).
3. The notification system shall handle up to 100k emails/day without degradation.

## Edge Cases & Error States

What happens when things go wrong or inputs are unexpected?

- What if the user's email bounces?
- What if the subscription is cancelled before the notification fires?
- What if the user is on a free plan with no expiry?
- What if the user has email notifications disabled?

Enumerate these explicitly. They're where most bugs live.

## Dependencies

What does this feature depend on?

- **Internal:** Other teams, services, or features that must exist first
- **External:** Third-party APIs, vendor contracts, infrastructure
- **Data:** Analytics events, database migrations, backfills

## Risks & Open Questions

What could go wrong? What don't we know yet?

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Email provider rate limits | Medium | Notifications delayed | Batch sends, use queue |
| Users mark emails as spam | Low | Domain reputation hit | Include easy unsubscribe |

### Open Questions
- [ ] Do we send notifications for annual plans only, or monthly too?
- [ ] What timezone do we use for "7 days before"?

## Timeline (Optional)

If relevant, rough phasing:

- **Phase 1:** 7-day expiry email (2 weeks)
- **Phase 2:** 1-day expiry email + admin dashboard (1 week)
- **Phase 3:** In-app notification banner (1 week)

Don't commit to dates in the PRD — that happens in sprint planning. Phasing is about *order*, not calendar.
```
