# Business application templates

The Backend library contains five application starters, in addition to the notes and commerce
starters. Each creates editable pages, a provider-neutral model, resource queries, access rules and
transactional commands together. The executing provider for these starters is NestJS with
PostgreSQL. Export all generated pages together as React or Vue source.

## Create and run an application

1. Open a document without an existing Backend or authentication flow. Choose **Services &
   Workflows → Backend → Browse backend library** and open a template card.
2. Review the included pages and roles. Choose the existing local Keycloak profile, or supply a
   public OIDC issuer and client ID. Enter no client secret in a document.
3. Choose **Use template**. Creation is one undo step and preserves unrelated pages. An existing
   backend, login flow or unsaved backend draft prevents creating a second application.
4. Configure accounts in the identity service. The verified JWT `openpencil_roles` array must
   contain the exact role IDs listed below. Editing a display name or browser state grants no role.
5. Use the [desktop NestJS preview](./backend-nestjs.md#desktop-live-preview), or export the complete
   application and follow the generated NestJS README for PostgreSQL, JWT verification and the
   same-origin API mount. Template creation itself starts no services and changes no database.
6. Sign in and register a profile on **Account setup** before an operation asks for a registered
   account. Relation pickers load authorized records; users do not need to copy database UUIDs.

The UI includes navigation, paginated lists, search and applicable filters, selected-record details,
forms, confirmation, error feedback, refreshed data and saved-request recovery. English and Chinese
page copy are available. A browser check uses an isolated test identity and scripted HTTP responses;
real account consent and deployment require the configured identity service.

## Combine modules in one application

An existing NestJS application can add these five starters as business modules. Open **Services &
Workflows → Backend → Browse backend library**, choose a business template and review **Add module**.
The library shows whether it is ready, already installed or blocked, together with the added-page
count, shared routes and compatibility conflicts. Save or discard an unsaved Backend draft first.

Adding a module preserves the application ID, OIDC configuration, existing models and authored
pages. It reuses the public sign-in route and a compatible account-setup page. Shared account data
is reused only when its schema and authority agree exactly. Each additional module gets its own
account-directory projection; existing directory permissions are preserved. Installing a module or
declaring a dependency never grants a role, row access or merchant/project membership.

Navigation links are appended to template-owned navigation when safe. Authored pages receive a
separate navigation block when the existing navigation cannot be identified safely. Existing links,
controls and custom content remain. The model, new pages and navigation form one undo step;
editing the document or changing its Provider invalidates an earlier review. Duplicate modules,
conflicting identifiers, incompatible shared accounts and missing login routes block installation.

The five modules can combine with one another, or extend the single-merchant and multi-merchant
commerce applications. Commerce remains one module so checkout, inventory, refunds and settlement
retain their existing transaction rules. In the data-model editor, select the owning module before
adding a custom table. Changes to relationships and permissions must still satisfy the complete
module contract.

Export every application route together as React or Vue. The backend export contains one NestJS
application, one PostgreSQL database and one migration history. `src/modules/<module-id>/module.ts`
owns each module's resources and command controller/service. Shared account, authentication,
database and transactional command infrastructure remain in the same process. `module-manifest.json`
and `MODULES.md` explain ownership and dependencies. This edition does not generate independently
deployed microservices, queues or distributed transactions.

The optional Backend IR `modules` declaration is a complete partition of entities, HTTP resources
and commands, with an acyclic dependency graph. It supports at most 16 modules and 128 commands in
total, with at most 16 commands per module. Applications without this declaration retain their
existing 16-command limit and generation layout. Other Providers, Backend V2, and modular apps
containing workflow or storage declarations are rejected until their execution and ownership
contracts are implemented.

Installation changes only the document. Use the separate
[Managed Preview SQL review](./backend-nestjs.md#desktop-live-preview) before using new tables in an
existing preview database. New model entities change command-definition digests: old idempotency
records remain, but replaying an old key can return `409` after that change. Reconcile outstanding
operations before upgrading; do not replace an unresolved attempt's key to force another execution.

## Included workflows

| Starter                    | Main workflow                                                                             | Identity-service roles                                    |
| -------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Customer CRM               | Create/edit customer → assign → follow up → advance sales stage → won/lost                | `crm-manager`                                             |
| Service desk               | Submit → assign → start → request approval → independent approve/reject → close or resume | `support-manager`, `support-agent`, `support-approver`    |
| Content and knowledge base | Draft → edit → submit → independent review → public/internal publish → withdraw           | `content-author`, `content-reviewer`, `content-publisher` |
| Booking and registration   | Configure service/time slot → register places → reschedule/cancel → mark completed        | `booking-manager`                                         |
| Projects and tasks         | Create project → add members → create/assign tasks → progress → complete/cancel/reopen    | `project-manager`                                         |

### Customer CRM

Ordinary signed-in accounts can create customers using their own registered profile. The current
assignee can read the customer and its follow-up history, edit contact details, record follow-ups
and advance the pipeline. Managers can assign customers to registered accounts and access the
customer workspace. Stages are `new`, `contacted`, `qualified`, `proposal`, `won` and `lost`.
Existing-record commands lock the customer, validate the current assignee or manager, and append
history in the same transaction. A previous assignee cannot read the current record or replay an
existing-record command after reassignment unless still independently authorized as `crm-manager`.

### Service desk

A requester selects their own registered profile and describes an issue with priority 1–3.
Managers assign the ticket to an account. Processing requires both the assignment and a verified
`support-agent` role. Approval requires `support-approver`, and both the original requester and the
person who submitted the approval request are excluded from approving or rejecting that request.
Rejected work must explicitly resume before another approval request. Approved work can close.

This edition has one independent approval stage. It does not include a configurable approval
chain, escalation scheduler, email ingestion, attachments or outgoing notifications.

### Content and knowledge base

Authors own drafts. Reviewers inspect submitted articles and cannot review their own work.
Publishers choose public or internal publication after approval. Submission freezes edits. A reviewer can return an article under review to draft; a publisher
can withdraw an already published article to draft. Authors cannot withdraw a pending review, and
there is no direct return from approved to draft. Each transition adds history.

Articles use plain text with a body limit of 8,192 characters. The editable body is returned in full
when opening a draft, and reader details scroll through the complete body. There is no rich-text,
file-upload or revision-diff editor in this edition.

The public resource enforces `status = published` **and** `visibility = public` for both lists and
details. The internal resource requires a verified signed-in account and enforces published status.
Public/internal resources do not inherit staff access to drafts or review notes. Search filters
cannot weaken these conditions. Withdrawal removes the article from those reader resources.

An application instance represents one organization: every verified account of that application's
configured identity service can read internally published articles. Tenant-specific internal
knowledge spaces require additional modeling after export.

### Booking and registration

Managers maintain services and explicit time slots, including capacity and availability. A
registered account books a positive whole-number quantity for a selected service and slot. The
backend verifies the service/slot relationship, availability, remaining capacity and the current
server time while holding the shared service lock.

Booking, cancellation, capacity edits and rescheduling use that same parent lock. Rescheduling
restores the old capacity and reserves the new capacity in one transaction; any failure rolls back
both changes. The new slot must be different and belong to the same service; the quantity stays unchanged.
Cancellation and rescheduling are allowed only before the original slot starts. A request waiting for a lock must still
pass the time check after acquiring it. Saved retries reserve or release capacity once.

Date inputs use ISO 8601 timestamps with an explicit time zone, for example
`2030-05-20T09:00:00+08:00`. This starter does not include recurring calendar rules, local calendar
widgets, reminders, paid deposits or external calendar synchronization. Capacity is tracked independently per slot;
it does not detect overlapping slots or shared staff/room conflicts.

### Projects and tasks

Project managers create projects and manage membership in the projects they own. The global
`project-manager` role does not grant access to another manager’s project. Tasks belong to a project and are assigned
through its active members. Current members can read their project's records, while task changes
also validate the command's role or assignment. Foreign keys and command checks reject cross-project
assignment. Member removal and task mutations serialize through the project parent so a membership
change cannot race with a task command. A removed member cannot replay an existing-record command
to bypass the current membership rule.

Tasks include a due time, description, assignee and status (`todo`, `in_progress`, `done`,
`cancelled`), with history for mutations. This edition uses list/detail workspaces; drag-and-drop
boards, Gantt charts, dependencies, chat and notifications are subsequent extensions.

## AI creation and editing

The built-in Direct AI tool `create_business_app` takes one of these `kind` values:

- `customer-crm`
- `service-desk`
- `content-knowledge-base`
- `booking-registration`
- `project-tasks`

Use `locale: zh-CN` for Chinese copy. For example, ask the editor AI:

> 创建一个中文客户管理应用，使用 CRM 模板，保留客户分配、跟进记录和阶段推进，采用简洁的蓝灰色界面。

The tool creates the model and working controls before visual styling. Preserve the returned pages,
OIDC route, data bindings, relation pickers, confirmation and request recovery when restyling.
Export every returned page together. Existing documents are not silently upgraded to a new starter.

For an existing application, ask:

> 在现有商城里添加客户管理和工单模块，复用现在的登录，保留已有页面和权限。

The tool uses `mode: add-module` for each requested module and omits authentication overrides.
It returns `exportPageIds` for every existing and added application route. The same review,
unsaved-draft protection and atomic undo apply to AI installation. `mode: create` remains the default
for a new application.

## Authorization and export boundaries

These starters reuse bounded data-only contracts: fixed read conditions, verified identity or role,
related membership, a locked command parent, typed parameters and explicit mutation steps. They do
not execute code supplied by a template manifest. Providers that cannot implement a rule reject it;
unsupported semantics are not silently dropped during conversion.

The basic permission editor displays compound rules and command-bound rules without reducing them
to a simpler selector. Referenced entities, fields, roles and policies are protected from deletion.
For changes beyond that form, customize the generated backend and review the associated resources,
commands and database constraints together.

Commands store immutable responses for idempotent replay. Existing-record commands verify current
record permissions before returning a stored response. A creation command may replay the original
creation receipt to its original caller after a later reassignment; that receipt does not fetch or
reveal subsequent changes. The browser's saved request journal retains parameters until the user
reviews and acknowledges the attempt; use the generated recovery controls to resolve interrupted
operations before issuing a fresh key.

Real payments, carrier APIs, actual payouts, message delivery, file storage, calendar integrations
and organization-specific workflows remain export-time extension points. The starters provide
working local application flows; they do not provision a production service or certify a real
identity-provider deployment.
