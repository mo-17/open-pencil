# Business application templates

The Backend library contains nineteen application starters, in addition to the notes and commerce
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

After creation, open **Getting started** in the Backend panel. The guide reads the saved application
and lists its public OIDC configuration, referenced template roles and preparation steps for each
recognized business module. It distinguishes unsaved drafts from saved configuration, and updates
when modules are added or undone. The page list uses the document's current route names, including
renamed routes; opening a page does not select it for export. Export the complete application and
follow the generated NestJS `README.md` and `LOCAL-RUN.md` for the exact environment names,
access-token role mapping, account-record initialization and startup order. The guide does not check
service availability or perform identity, database or deployment setup.

The UI includes navigation, paginated lists, search and applicable filters, selected-record details,
forms, confirmation, error feedback, refreshed data and saved-request recovery. English and Chinese
page copy are available. A browser check uses an isolated test identity and scripted HTTP responses;
real account consent and deployment require the configured identity service.

Actions with a selected-record condition expose their normal entry only when that condition
matches. Asset handover checks both request kind and pending status. When an operation is no longer
applicable, its saved-request review entry remains available, including after leaving and returning
to a page. Refreshing a list preserves the open form's unsent input and shows why a current selection
is required. These display conditions do not replace server authorization or transaction checks.

## Combine modules in one application

An existing NestJS application can add these nineteen starters as business modules. Open **Services &
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

Selected modules can combine with one another, or extend the single-merchant and multi-merchant
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

The complete application also has a 20,000-node Backend data budget, counting JSON values across
all modules. Combining all nineteen business templates exceeds the application budgets, as does adding full
multi-merchant commerce, even though their individual module budgets pass. Composition rejects
the oversized application without changing the existing document. Choose the modules the application
needs and export that selection; hospital with CRM and restaurant ordering, video with CRM, and
video with commerce, and CRM with assets, contracts and recruitment are supported combinations.

Installation changes only the document. Use the separate
[Managed Preview SQL review](./backend-nestjs.md#desktop-live-preview) before using new tables in an
existing preview database. New model entities change command-definition digests: old idempotency
records remain, but replaying an old key can return `409` after that change. Reconcile outstanding
operations before upgrading; do not replace an unresolved attempt's key to force another execution.

## Included workflows

| Starter                              | Main workflow                                                                                            | Identity-service roles                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Customer CRM                         | Create/edit customer → assign → follow up → advance sales stage → won/lost                               | `crm-manager`                                             |
| Service desk                         | Submit → assign → start → request approval → independent approve/reject → close or resume                | `support-manager`, `support-agent`, `support-approver`    |
| Content and knowledge base           | Draft → edit → submit → independent review → public/internal publish → withdraw                          | `content-author`, `content-reviewer`, `content-publisher` |
| Booking and registration             | Configure service/time slot → register places → reschedule/cancel → mark completed                       | `booking-manager`                                         |
| Projects and tasks                   | Create project → add members → create/assign tasks → progress → complete/cancel/reopen                   | `project-manager`                                         |
| Rental and property viewing          | Create/edit listing → publish → open viewing slots → reserve/reschedule/cancel → complete                | `rental-tenant`, `rental-landlord`, `rental-admin`        |
| Personal blog                        | Category → draft → edit → publish/withdraw → public reading → private bookmark                           | `blog-author`                                             |
| Automotive news                      | Brand/model/category → draft → publisher review → publish/withdraw → read/bookmark                       | `auto-editor`, `auto-publisher`                           |
| Hospital registration                | Departments and doctors → schedules → patient profile → reserve/cancel/restore → check in → complete     | `hospital-admin`, `hospital-staff`                        |
| Restaurant ordering                  | Menu → cart → dine-in/pickup checkout → accept → prepare → ready → complete                              | `food-manager`                                            |
| Video library and live channels      | Draft/edit video → publish/archive; schedule channel → mark live → end; save/cancel/restore favorites    | `media-creator`, `media-admin`                            |
| Procurement and inventory            | Catalogs → purchase → partial receipts → dispatch → bounded returns → stocktake                          | `inventory-manager`, `inventory-operator`                 |
| Enterprise approvals                 | Leave/expense/purchase draft → submit → first review → second review → approved/rejected                 | `oa-reviewer`, `oa-approver`                              |
| Survey forms                         | Edit draft → publish immutable version → one response per account/version → close collection             | `survey-manager`                                          |
| Online courses                       | Draft course/chapters → publish → enroll → complete and submit → instructor grade                        | `course-instructor`, `course-student`                     |
| Community forum                      | Submit post/reply → moderator review → public discussion → close; private follows and reports            | `community-moderator`                                     |
| Asset management                     | Register asset → request assignment/loan → manager issue → return → repair/retire                        | `asset-manager`                                           |
| Quotes and contract fulfillment      | Counterparty → quote version → record confirmation → partial delivery → record acceptance → close/cancel | `contract-manager`                                        |
| Recruitment and employee transitions | Position → candidate → interview feedback → hiring → onboarding checklist → offboarding checklist        | `recruitment-hr`                                          |

### Asset management

`asset-management` tracks individual assets with permanently unique tags. Authenticated employees
can browse the limited available-asset projection and make assignment or time-limited loan requests.
Requests do not reserve stock: an administrator with `asset-manager` chooses which pending request
to fulfill, and the server permits only one active custody per asset. Loan issuance checks the
original requested due time again; expired requests cannot be issued by changing a browser field.

Managers record returns, repairs and retirement. An in-use asset must be returned before repair or
retirement, and retired assets cannot be reactivated. Asset state, the current custody reference,
request status and append-only audit records change together with version checks. Employees see
their own requests; full custody and audit views require the manager role. This is a single
organization's asset register, not automatic integration with procurement SKU quantities. Barcode
scanning, depreciation and notifications remain post-export work.

### Quotes and contract fulfillment

`quote-contracts` is an internal `contract-manager` workspace for each operator's private
counterparties, quote drafts, published quote versions and contracts. Each quote has one line item;
the server calculates integer CNY-cent totals. Publishing freezes the quote and counterparty
snapshot. Recording confirmation requires the current version and creates at most one contract
per quote draft; later directory changes do not rewrite the agreed snapshot.

Record partial deliveries against the contract, then record acceptance in delivery order. The
server checks the original contract, current revision and cumulative quantities. Closing requires
all contracted quantities to be delivered and accepted. Cancellation preserves the records and
does not refund or transfer money. Confirmation and acceptance are explicit internal records with
supporting references, not customer electronic signatures or proof of payment. Electronic signing,
invoices, payment collection, multi-line quotes and CRM data synchronization are post-export work.

### Recruitment and employee transitions

`recruitment-hr` is an internal HR workspace. Verified HR operators manage only their own positions,
candidates, interview feedback, employees and history; private recruitment information does not
enter the shared account directory. There is no applicant, interviewer or employee self-service
portal. Interview feedback records a human assessment and does not automatically hire a candidate.

Hiring and starting onboarding are separate recorded actions. A candidate can create only one
employee record. Onboarding and offboarding use distinct checklists; each must contain work and be
fully completed before the transition is confirmed. Version checks and transactional counters
prevent duplicate completion or stale state changes, with append-only history. These actions record
business work only: they do not grant or revoke OIDC roles, create accounts, calculate payroll,
upload resumes, notify candidates or synchronize another business module.

### Procurement and inventory

`procurement-inventory` models one organization with SKU, warehouse and supplier catalogs. Create
one inventory balance for each SKU/warehouse pair before opening a purchase or dispatch. Each
purchase or dispatch has one SKU and warehouse; purchase receipts can be partial. The server
changes balances and appends movement records in the same transaction. Supplier returns cannot
exceed received quantities; customer returns cannot exceed the original dispatch. Returns and
dispatches cannot make stock negative. Stocktakes require the displayed version to prevent an
outdated count from overwriting a newer movement.

Managers maintain catalogs, purchases and stocktakes; operators handle receipts, dispatches and
returns. Amounts use integer CNY cents and are records only. Multi-line purchase transactions,
warehouse transfers, stock batches, costing, accounting and payments remain extensions after export.
Adding this module to commerce shares accounts, not SKU identity or inventory balances; implement
an explicit business integration before using one module's stock to fulfill the other's orders.

### Enterprise approvals

`enterprise-approvals` includes separate leave, expense and purchase forms, an applicant tracking
page, and two role-restricted review queues. Applicants can edit drafts, submit, cancel unfinished
requests, and reopen rejected requests. Each review and mutation checks the locked current version.
The applicant cannot approve their own request; the second reviewer must also differ from the first.
Applicants can inspect their own append-only history. Reviewers see their current stage's queue,
not other applicants' drafts. Completing a review removes the request from that queue.

This is a fixed two-stage process, with no arbitrary workflow designer or delegated reviewer graph.
Expense amounts are CNY-cent application records; no payment, payroll or leave-balance calculation
occurs. Connect notifications and external HR/finance systems after export.

### Versioned survey forms

`survey-forms` contains a fixed 1–5 rating, a choice of option 1/2/3 and a bounded text response.
Managers edit question prompts and option text in a draft. Publishing copies that content to an
immutable numbered version; editing the draft later does not change old questions or responses.
Each verified account submits once per published version. Closing a version and submitting a
response use the same version lock so late submissions are rejected.

Public readers see question versions. Only the submitting account and survey managers can read
answers. The template provides individual response lists and details, with no aggregate chart,
arbitrary question designer, anonymous submissions or answer editing/deletion.

### Online courses and training

`online-courses` provides text chapters, a written exercise per chapter, enrollments and learning
records. Instructors can edit their own draft courses and chapters. Publishing requires at least
one chapter and freezes its content. Closing a course stops new enrollment while existing active
students retain access. Only accounts with `course-student` can enroll, once per course.

Students submit one final answer or learning note per chapter. That record marks the chapter
completed; it is not proof that a student watched media or passed an exam. Only the course's current
instructor can grade other students, with one final score from 0 to 100 and feedback. Students see
only their own submissions and grades. Revoking enrollment removes chapter access; existing
learning records remain readable to their student and instructor. Re-enrollment after revocation
is not part of this starter.

The first version uses plain text and instructor grading. Video lessons, automatic exams,
certificates, timed access and paid enrollment are post-export integrations.

### Moderated community

`community-forum` provides plain-text posts and replies with review before publication. Members
can edit pending or rejected content for review. Moderators publish or reject posts and publish or
remove replies. Closed discussions remain publicly readable but stop accepting new replies;
closing is archival, not deletion. Private thread follows support cancellation/restoration.
Members can submit reports and moderators can record their resolution. Reports and moderation
reasons are absent from public projections.

This starter does not implement real-time chat, notifications, rich text, accepted-answer ranking,
a full moderation event log or cascading content deletion. Connect those features explicitly after
export. Combining this module with a blog or course does not automatically attach threads to its
articles or lessons.

### Personal blog and automotive news

Choose **Personal blog** (`personal-blog`) for an author-managed blog, or **Automotive news**
(`automotive-news`) for an editorial site with vehicle catalogs. Both create editable React/Vue
pages and a NestJS backend. They use independent `blog_` and `auto_` tables and can share the
existing account and login when composed with other business modules.

The blog has seven pages: login/account setup, public categories and articles, private bookmarks,
and category/article management. Grant `blog-author` to the intended owner through the identity
service. Authors can manage their own articles. The template does not assign that role during
account registration or enforce that an identity service has granted it to only one person.

Automotive news has twelve pages. It adds public and managed brand/model directories and a
separate publication desk. Grant `auto-editor` for writing and editing owned drafts, and
`auto-publisher` for reading editorial submissions and publishing or withdrawing articles.
Grant both roles only when an operator should perform both functions. Vehicle descriptions,
segments and energy types are editorial data, not manufacturer-verified specifications or live
pricing. Create the brand and model before selecting that model for an article.

Article bodies are bounded plain text, with multiline editing and scrollable reading areas. HTML
is displayed as text. Authors create drafts, edit them, and publish when ready; a published article
must be withdrawn to draft before changing its body. The public list/read endpoints return only
published records, including server-side search and category/model filters. Administrative history
stays separate from public content. Deactivating a category or vehicle does not withdraw existing
articles automatically; withdraw the relevant articles through the publication action when needed.

Each signed-in reader can save an article once, cancel that bookmark, and restore the original
record while the article remains published. Bookmarks contain article IDs and state, without copies
of titles or bodies. Selecting a bookmark reads the current public article; after withdrawal it
returns no article content. The page remains a manually refreshed view, and cannot retract bytes a
reader has already received. Related-list metadata uses a checked `selectionField` to match the
bookmark's `article_id` against the public article resource's `id` filter.

Both starters are client-rendered applications. They do not implement per-article server rendering,
search-engine prerendering, RSS, comments, subscriptions, Markdown rendering, image uploading or
external content ingestion. Add these after export as needed. Automotive news also leaves dealer
inventory, live quotations, lead transactions and scraping outside the starter.

### Hospital registration

Choose **Hospital registration** in the Backend library or ask the built-in AI to create a
hospital registration platform (`kind: hospital-registration`). It represents one hospital with
multiple departments, doctors and schedules. The eleven generated pages include shared sign-in
and account setup, public department/doctor/schedule browsing, private patient profiles and
appointments, and separate department, doctor, schedule and appointment management workspaces.

Grant `hospital-admin` through the configured identity service to maintain departments, doctors
and schedules. Both `hospital-admin` and `hospital-staff` may handle appointments. Doctor entries
are public directory records; creating one does not create a login or prove a clinician's identity.
A user's account profile and private patient profiles are separate: a signed-in account can manage
its own patient records, including family members. These contain names, contact details and
relationship labels, without identity-document numbers, diagnoses or medical records.

Administrators create a department, create its doctor, and create a schedule with start/end times,
location, capacity and fee. Times use ISO 8601 with an explicit time zone. Schedule updates change
capacity and availability; existing doctor/time/fee details remain fixed. Create another schedule
for a new time or fee. Fees are integer CNY cents (`2500` = ¥25.00) and are copied from locked server
records into an appointment. The template neither collects money nor produces a payment receipt.

Select a schedule and one of your active patient profiles to reserve a place. The server locks
and rechecks ownership, current department/doctor availability, schedule relationships and time,
and remaining capacity before writing the appointment and history in one transaction. It allows
one appointment record per patient-record/schedule pair. This does not identify the same natural
person across duplicate profiles or accounts, or detect overlapping appointments across schedules.

Cancel a confirmed appointment before its start to release one place. To book that same patient
and schedule again, use **Restore appointment** on the cancelled record, which checks current
availability and refreshes the server snapshots. Changing to another schedule means cancelling
and making a new reservation. Saved requests retain their original Idempotency-Key; repeating a
successful request does not reserve or release another place.

Staff may cancel a confirmed appointment even after its start, check in a confirmed appointment
during its inclusive start/end window, and complete an appointment only after check-in. Deactivating
a patient prevents new reservations and restoration but leaves cancellation available. Patient
master lists remain owner-only; staff appointment views expose the appointment's necessary patient
and contact snapshots, with explicit history. Completion records an administrative status, not a
diagnosis or a verified medical treatment.

Use **Refresh** for current lists. Closing a department or doctor does not automatically close
all its schedules, cancel existing appointments or notify patients. Remaining schedule metadata
may stay visible, while booking checks the current parent status. Handle affected appointments
explicitly. Real identity verification, payments/refunds, HIS/insurance systems, SMS, appointment
reminders, queue calling, clinical records and multi-hospital tenancy are post-export integrations.

### Restaurant ordering

Choose **Restaurant ordering** in the Backend library or ask the built-in AI for a restaurant ordering
app (`kind: food-ordering`). The eight generated pages contain shared sign-in and account setup,
menu, cart items, checkout, private orders, kitchen orders and menu management. It can also join a
compatible application as one module; food and commerce retain separate tables and transactions.

This starter represents one restaurant. Verified customers browse available menu items, set cart
quantities, remove items and submit dine-in or pickup orders. Prices are integer CNY cents: `1800`
means ¥18.00. Choose the cart in checkout to see the server subtotal and item details. Dine-in
requires a table number; both modes require a contact name. Phone and note are optional.

The server locks the caller's cart, checks its revision and each item's current availability and
price, then writes an order, item snapshots and history and clears the cart in one transaction.
A changed price, stale cart or unavailable item returns a conflict without creating a partial order.
Update the affected item in the cart and review checkout again. Limits are 50 distinct items and
99 of each item. This is availability control; it does not reserve ingredient or stock quantities.
An Idempotency-Key is mandatory, and saved retries return the same order instead of charging or
ordering twice. Amounts, owner IDs and order status are never accepted as checkout parameters.

Staff need the verified `food-manager` role, and register their own account profile before creating
menu items. The role manages the whole restaurant, including menu entries created by other staff.
Kitchen orders move **pending → accepted → preparing → ready → completed**. Customers can cancel
only their own pending orders; staff can reject an unfinished order. Every transition appends
history. Kitchen lists use the explicit **Refresh** button, with filters retained; there is no
push notification or realtime subscription in this starter.

Export every route together as React or Vue with the NestJS backend. Configure PostgreSQL and OIDC
as described above. Real payment, refunds, receipt printers, QR table sessions, delivery platforms,
reservations, loyalty/discount pricing and multiple restaurants need post-export implementation.

### Video library and live channels

Enable **Video** in Settings → Plugins, then select **Video library and live channels** in the
Backend library. It can create a standalone application or join a compatible NestJS application
as the `video-live` business module. The built-in AI accepts the same `kind` through
`create_business_app`. Installation checks the enabled plugin again before committing a change.

The seven generated pages include sign-in, account setup, the video catalog (`/videos`), live
channels (`/live`), private favorites (`/favorites`), and video/channel creator workspaces.
Public resources expose only published videos and scheduled, live or ended channels. Creators
must register their own profile and receive `media-creator` or `media-admin` from the identity
service before creating content. Owners manage their records; `media-admin` can manage all content.
The generated navigation does not grant these permissions.

Set a public HTTPS `playback_url` and optional `poster_url`. React and Vue exports bind the player
to the current detail record and clear the old player when selection or account context changes.
MP4/WebM use the browser's media support; `.m3u8` sources use bundled `hls.js`, requiring compatible
Media Source Extensions and codecs. HLS requests omit credentials and reject redirects and unsafe
URLs, including playlist, segment and key requests; configure CORS on all referenced media.
Stream keys, private credentials and signed URL secrets do not belong in these public fields.
Native/mobile targets and ordinary browser Compiler Preview do not gain this playback capability.

Publishing a video requires a configured playback URL. Channel scheduling uses ISO 8601 with a
time zone; operators explicitly mark a channel live or ended. These transitions record application
state and audit history, not verified stream health. Restoring archived content returns it to draft
for publication review. There is no automatic scheduler, ingest endpoint, video upload,
transcoder, CDN provisioning, DRM, paid access, realtime chat or viewer-count service in this starter.
Connect those services after export and keep their credentials on the server.

Authenticated viewers can favorite a currently published video. A unique user/video record prevents
duplicates; canceling retains that record, and restoring checks both ownership and current video
publication. The favorites list contains a title snapshot and no private playback URL. Open the video
catalog to view currently published content. Commands keep the shared idempotent retry/review flow.

### Rental and property viewing

Install and enable **VR Tour** in Settings → Plugins before creating this starter or adding its
business module. The public catalog lists published properties. A landlord manages only their own
properties, slots and viewing appointments; administrators can manage all properties. New reservations
require the `rental-tenant` role, assigned by the identity service (it may be configured as the default
role for tenant accounts). Existing tenants retain their own cancellation/rebooking access. Tenants
see their own appointments and can cancel or reschedule them. Server commands check the current
property status, time, remaining capacity and caller authority inside a transaction, with audit
history and idempotent retries. Times use ISO 8601 with an explicit time zone. Prices are integer
monthly cents and area uses hundredths of a square metre; label and convert them explicitly in a
customized UI.

Select a property to view its configured `panorama_url`. The reviewed VR module treats it only as
an image URL, validates it again at runtime and requires a new load action when the selection
changes. Static room and hotspot configuration remains available for standalone modules. Prepare
your own 2:1 equirectangular images; public HTTPS images need CORS, or copy local export images into
`public/assets/vr-tour/` and reference `/assets/vr-tour/<file>.jpg`.

Authenticated users can read non-sensitive active slot metadata. Reservation commands also lock
and recheck the property, so an archived property cannot accept a new reservation even when old
slot metadata remains readable. Appointment contact information is private to its tenant, the
property landlord and administrators. Rent payments, leases, identity verification and notifications
remain export-time integrations.

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
