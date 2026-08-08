# Deliivo (Bugs and Improvements) — Setup

This document helps you create the recommended Projects (beta) board and supporting labels and templates for tracking bugs and improvements.

Project name
- Deliivo (Bugs and Improvements)

Recommended fields (Projects (beta))
- Status (single-select): To do, In progress, Blocked, In QA, Done
- Priority (single-select): High, Medium, Low
- Severity (single-select): Critical, Major, Minor
- Estimate (number)
- Release (single-select or single-line text)

Board view
- Create a Board view grouped by the Status field so each option becomes a column.

Automations (recommended)
- When a new issue is added to the project → set Status = To do
- When label `blocked` is applied → set Status = Blocked
- When label `ready-for-qa` is applied → set Status = In QA
- When an assignee is added or a linked PR is opened → set Status = In progress
- When issue is closed OR Status changes to Done → move card to Done / archive

Labels
- Use the included script `scripts/create_labels.sh` to create the labels in a repository.

How to run the labels script
1. Install and authenticate the GitHub CLI (gh) with sufficient repo permissions.
2. From the repository root run:

   bash scripts/create_labels.sh infoDeliivo deliivo-be

(Replace owner/repo as needed for other repositories.)

Creating the Projects (beta) board (manual steps)
1. In GitHub, at the organization level (Deliivo) click: Projects → New project.
2. Choose "Projects (beta)".
3. Name the project: `Deliivo (Bugs and Improvements)` and set visibility (Org-only or public as you prefer).
4. Create the fields described above. For the Status field, make it single-select and create the five options.
5. Add a Board view and group by the Status field so columns show: To do, In progress, Blocked, In QA, Done.
6. Add the automation rules listed above using the Automation tab in the project.

Automating project creation (org owner only)
- The GraphQL API for Projects (beta) can create a project and add fields, but this requires an org administrator token with the `project` scope. If you want, I can provide a GraphQL script you (or an org owner) can run to create the project and fields programmatically.

Issue templates
- This repo already includes two issue templates in `.github/ISSUE_TEMPLATE/` for bugs and improvements. They default to labels `bug` and `improvement` and add `triage-needed`.

Need me to also:
- Provide a GraphQL script to create the org Project (beta) programmatically (requires org owner to run).
- Open a PR that applies these templates to `main` if you'd like me to open one after review.
