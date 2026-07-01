-- Demo Supabase billing schema for Stripe-backed lowcode apps.
--
-- Apply this manually before adapting the demo Stripe Edge Functions for
-- production. The generated SPA must never write these tables directly with
-- Stripe secrets; webhook and customer-portal Edge Functions should use a
-- service role key from server environment variables.
--
-- Stripe does not guarantee webhook delivery order. Cross-event identifiers in
-- read-model tables are stored as text instead of foreign keys so invoice,
-- payment, refund, and subscription events can be processed independently.

create table if not exists public.billing_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique check (stripe_customer_id like 'cus_%'),
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_subscriptions (
  stripe_subscription_id text primary key check (stripe_subscription_id like 'sub_%'),
  user_id uuid references auth.users(id) on delete set null,
  stripe_customer_id text not null references public.billing_customers(stripe_customer_id),
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  plan text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default false,
  plan text,
  status text,
  stripe_subscription_id text references public.billing_subscriptions(stripe_subscription_id)
    on delete set null,
  current_period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_invoices (
  stripe_invoice_id text primary key check (stripe_invoice_id like 'in_%'),
  user_id uuid references auth.users(id) on delete set null,
  stripe_customer_id text not null references public.billing_customers(stripe_customer_id),
  stripe_subscription_id text,
  status text,
  paid boolean not null default false,
  amount_due integer,
  amount_paid integer,
  currency text,
  hosted_invoice_url text,
  invoice_pdf text,
  period_start timestamptz,
  period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_tax_summaries (
  stripe_invoice_id text primary key references public.billing_invoices(stripe_invoice_id)
    on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  stripe_customer_id text not null references public.billing_customers(stripe_customer_id),
  automatic_tax_enabled boolean,
  automatic_tax_status text,
  automatic_tax_provider text,
  tax_amount integer,
  currency text,
  total_taxes jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_usage_summaries (
  stripe_invoice_line_id text primary key,
  stripe_invoice_id text not null references public.billing_invoices(stripe_invoice_id)
    on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  stripe_customer_id text not null references public.billing_customers(stripe_customer_id),
  stripe_subscription_id text,
  stripe_subscription_item_id text,
  stripe_price_id text,
  stripe_product_id text,
  quantity_decimal text,
  amount integer,
  currency text,
  period_start timestamptz,
  period_end timestamptz,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  raw_line jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_payments (
  stripe_payment_intent_id text primary key check (stripe_payment_intent_id like 'pi_%'),
  user_id uuid references auth.users(id) on delete set null,
  stripe_customer_id text not null references public.billing_customers(stripe_customer_id),
  status text,
  amount integer,
  currency text,
  latest_charge_id text,
  receipt_email text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_refunds (
  stripe_charge_id text primary key check (stripe_charge_id like 'ch_%'),
  user_id uuid references auth.users(id) on delete set null,
  stripe_customer_id text not null references public.billing_customers(stripe_customer_id),
  stripe_payment_intent_id text,
  refunded boolean not null default false,
  amount integer,
  amount_refunded integer,
  currency text,
  receipt_url text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_disputes (
  stripe_dispute_id text primary key check (stripe_dispute_id like 'du_%'),
  user_id uuid references auth.users(id) on delete set null,
  stripe_customer_id text references public.billing_customers(stripe_customer_id),
  stripe_charge_id text check (stripe_charge_id is null or stripe_charge_id like 'ch_%'),
  stripe_payment_intent_id text check (
    stripe_payment_intent_id is null or stripe_payment_intent_id like 'pi_%'
  ),
  status text,
  reason text,
  amount integer,
  currency text,
  disputed_at timestamptz,
  evidence_due_by timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_orders (
  order_key text primary key,
  user_id uuid references auth.users(id) on delete set null,
  stripe_customer_id text not null references public.billing_customers(stripe_customer_id),
  stripe_subscription_id text,
  stripe_invoice_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  status text,
  fulfillment_status text not null default 'unfulfilled',
  amount_total integer,
  amount_paid integer,
  amount_refunded integer,
  currency text,
  plan text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_events (
  stripe_event_id text primary key,
  event_type text not null,
  object_id text,
  processed_at timestamptz not null default now(),
  payload jsonb not null
);

create index if not exists billing_subscriptions_user_id_idx
  on public.billing_subscriptions(user_id);

create index if not exists billing_subscriptions_customer_idx
  on public.billing_subscriptions(stripe_customer_id);

create index if not exists billing_entitlements_active_idx
  on public.billing_entitlements(active);

create index if not exists billing_invoices_user_id_idx
  on public.billing_invoices(user_id);

create index if not exists billing_invoices_customer_idx
  on public.billing_invoices(stripe_customer_id);

create index if not exists billing_tax_summaries_user_id_idx
  on public.billing_tax_summaries(user_id);

create index if not exists billing_tax_summaries_customer_idx
  on public.billing_tax_summaries(stripe_customer_id);

create index if not exists billing_usage_summaries_user_id_idx
  on public.billing_usage_summaries(user_id);

create index if not exists billing_usage_summaries_customer_idx
  on public.billing_usage_summaries(stripe_customer_id);

create index if not exists billing_usage_summaries_invoice_idx
  on public.billing_usage_summaries(stripe_invoice_id);

create index if not exists billing_payments_user_id_idx
  on public.billing_payments(user_id);

create index if not exists billing_payments_customer_idx
  on public.billing_payments(stripe_customer_id);

create index if not exists billing_refunds_user_id_idx
  on public.billing_refunds(user_id);

create index if not exists billing_refunds_customer_idx
  on public.billing_refunds(stripe_customer_id);

create index if not exists billing_disputes_user_id_idx
  on public.billing_disputes(user_id);

create index if not exists billing_disputes_customer_idx
  on public.billing_disputes(stripe_customer_id);

create index if not exists billing_disputes_status_idx
  on public.billing_disputes(status);

create index if not exists billing_orders_user_id_idx
  on public.billing_orders(user_id);

create index if not exists billing_orders_customer_idx
  on public.billing_orders(stripe_customer_id);

create index if not exists billing_events_event_type_idx
  on public.billing_events(event_type);

create or replace function public.record_stripe_subscription_event(
  p_stripe_event_id text,
  p_event_type text,
  p_object_id text,
  p_payload jsonb,
  p_stripe_subscription_id text,
  p_stripe_customer_id text,
  p_status text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_plan text,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_user_id uuid;
begin
  if exists (
    select 1
    from public.billing_events
    where stripe_event_id = p_stripe_event_id
  ) then
    return 'duplicate';
  end if;

  select user_id
    into customer_user_id
  from public.billing_customers
  where stripe_customer_id = p_stripe_customer_id;

  if customer_user_id is null then
    raise exception 'No billing customer mapping for Stripe customer %', p_stripe_customer_id
      using errcode = 'P0001';
  end if;

  insert into public.billing_events (
    stripe_event_id,
    event_type,
    object_id,
    payload
  ) values (
    p_stripe_event_id,
    p_event_type,
    p_object_id,
    p_payload
  );

  insert into public.billing_subscriptions (
    stripe_subscription_id,
    user_id,
    stripe_customer_id,
    status,
    current_period_end,
    cancel_at_period_end,
    plan,
    metadata,
    updated_at
  ) values (
    p_stripe_subscription_id,
    customer_user_id,
    p_stripe_customer_id,
    p_status,
    p_current_period_end,
    coalesce(p_cancel_at_period_end, false),
    p_plan,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (stripe_subscription_id) do update set
    user_id = excluded.user_id,
    stripe_customer_id = excluded.stripe_customer_id,
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    plan = excluded.plan,
    metadata = excluded.metadata,
    updated_at = now();

  insert into public.billing_entitlements (
    user_id,
    active,
    plan,
    status,
    stripe_subscription_id,
    current_period_end,
    metadata,
    updated_at
  ) values (
    customer_user_id,
    p_status in ('active', 'trialing'),
    p_plan,
    p_status,
    p_stripe_subscription_id,
    p_current_period_end,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (user_id) do update set
    active = excluded.active,
    plan = excluded.plan,
    status = excluded.status,
    stripe_subscription_id = excluded.stripe_subscription_id,
    current_period_end = excluded.current_period_end,
    metadata = excluded.metadata,
    updated_at = now();

  return 'recorded';
exception
  when unique_violation then
    return 'duplicate';
end;
$$;

revoke all on function public.record_stripe_subscription_event(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  timestamptz,
  boolean,
  text,
  jsonb
) from public, anon, authenticated;

comment on function public.record_stripe_subscription_event(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  timestamptz,
  boolean,
  text,
  jsonb
) is
  'Service-role RPC for Stripe webhook handlers. Records the Stripe event and upserts billing_subscriptions in one transaction.';

create or replace function public.record_stripe_invoice_event(
  p_stripe_event_id text,
  p_event_type text,
  p_object_id text,
  p_payload jsonb,
  p_stripe_invoice_id text,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_status text,
  p_paid boolean,
  p_amount_due integer,
  p_amount_paid integer,
  p_currency text,
  p_automatic_tax_enabled boolean,
  p_automatic_tax_status text,
  p_automatic_tax_provider text,
  p_tax_amount integer,
  p_total_taxes jsonb,
  p_usage_lines jsonb,
  p_hosted_invoice_url text,
  p_invoice_pdf text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_user_id uuid;
begin
  if exists (
    select 1
    from public.billing_events
    where stripe_event_id = p_stripe_event_id
  ) then
    return 'duplicate';
  end if;

  select user_id
    into customer_user_id
  from public.billing_customers
  where stripe_customer_id = p_stripe_customer_id;

  if customer_user_id is null then
    raise exception 'No billing customer mapping for Stripe customer %', p_stripe_customer_id
      using errcode = 'P0001';
  end if;

  insert into public.billing_events (
    stripe_event_id,
    event_type,
    object_id,
    payload
  ) values (
    p_stripe_event_id,
    p_event_type,
    p_object_id,
    p_payload
  );

  insert into public.billing_invoices (
    stripe_invoice_id,
    user_id,
    stripe_customer_id,
    stripe_subscription_id,
    status,
    paid,
    amount_due,
    amount_paid,
    currency,
    hosted_invoice_url,
    invoice_pdf,
    period_start,
    period_end,
    metadata,
    updated_at
  ) values (
    p_stripe_invoice_id,
    customer_user_id,
    p_stripe_customer_id,
    p_stripe_subscription_id,
    p_status,
    coalesce(p_paid, false),
    p_amount_due,
    p_amount_paid,
    p_currency,
    p_hosted_invoice_url,
    p_invoice_pdf,
    p_period_start,
    p_period_end,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (stripe_invoice_id) do update set
    user_id = excluded.user_id,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    status = excluded.status,
    paid = excluded.paid,
    amount_due = excluded.amount_due,
    amount_paid = excluded.amount_paid,
    currency = excluded.currency,
    hosted_invoice_url = excluded.hosted_invoice_url,
    invoice_pdf = excluded.invoice_pdf,
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    metadata = excluded.metadata,
    updated_at = now();

  insert into public.billing_tax_summaries (
    stripe_invoice_id,
    user_id,
    stripe_customer_id,
    automatic_tax_enabled,
    automatic_tax_status,
    automatic_tax_provider,
    tax_amount,
    currency,
    total_taxes,
    updated_at
  ) values (
    p_stripe_invoice_id,
    customer_user_id,
    p_stripe_customer_id,
    p_automatic_tax_enabled,
    p_automatic_tax_status,
    p_automatic_tax_provider,
    p_tax_amount,
    p_currency,
    coalesce(p_total_taxes, '[]'::jsonb),
    now()
  )
  on conflict (stripe_invoice_id) do update set
    user_id = excluded.user_id,
    stripe_customer_id = excluded.stripe_customer_id,
    automatic_tax_enabled = excluded.automatic_tax_enabled,
    automatic_tax_status = excluded.automatic_tax_status,
    automatic_tax_provider = excluded.automatic_tax_provider,
    tax_amount = excluded.tax_amount,
    currency = excluded.currency,
    total_taxes = excluded.total_taxes,
    updated_at = now();

  insert into public.billing_usage_summaries (
    stripe_invoice_line_id,
    stripe_invoice_id,
    user_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_subscription_item_id,
    stripe_price_id,
    stripe_product_id,
    quantity_decimal,
    amount,
    currency,
    period_start,
    period_end,
    description,
    metadata,
    raw_line,
    updated_at
  )
  select
    line->>'id',
    p_stripe_invoice_id,
    customer_user_id,
    p_stripe_customer_id,
    coalesce(line->>'subscription', p_stripe_subscription_id),
    line->>'subscriptionItem',
    line->>'price',
    line->>'product',
    line->>'quantityDecimal',
    nullif(line->>'amount', '')::integer,
    coalesce(line->>'currency', p_currency),
    nullif(line->>'periodStart', '')::timestamptz,
    nullif(line->>'periodEnd', '')::timestamptz,
    line->>'description',
    coalesce(line->'metadata', '{}'::jsonb),
    line,
    now()
  from jsonb_array_elements(coalesce(p_usage_lines, '[]'::jsonb)) as line
  where coalesce(line->>'id', '') <> ''
  on conflict (stripe_invoice_line_id) do update set
    stripe_invoice_id = excluded.stripe_invoice_id,
    user_id = excluded.user_id,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_subscription_item_id = excluded.stripe_subscription_item_id,
    stripe_price_id = excluded.stripe_price_id,
    stripe_product_id = excluded.stripe_product_id,
    quantity_decimal = excluded.quantity_decimal,
    amount = excluded.amount,
    currency = excluded.currency,
    period_start = excluded.period_start,
    period_end = excluded.period_end,
    description = excluded.description,
    metadata = excluded.metadata,
    raw_line = excluded.raw_line,
    updated_at = now();

  insert into public.billing_orders (
    order_key,
    user_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_invoice_id,
    status,
    amount_total,
    amount_paid,
    currency,
    metadata,
    updated_at
  ) values (
    'invoice:' || p_stripe_invoice_id,
    customer_user_id,
    p_stripe_customer_id,
    p_stripe_subscription_id,
    p_stripe_invoice_id,
    p_status,
    p_amount_due,
    p_amount_paid,
    p_currency,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (order_key) do update set
    user_id = excluded.user_id,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    stripe_invoice_id = excluded.stripe_invoice_id,
    status = excluded.status,
    amount_total = excluded.amount_total,
    amount_paid = excluded.amount_paid,
    currency = excluded.currency,
    metadata = excluded.metadata,
    updated_at = now();

  return 'recorded';
exception
  when unique_violation then
    return 'duplicate';
end;
$$;

revoke all on function public.record_stripe_invoice_event(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  boolean,
  integer,
  integer,
  text,
  boolean,
  text,
  text,
  integer,
  jsonb,
  jsonb,
  text,
  text,
  timestamptz,
  timestamptz,
  jsonb
) from public, anon, authenticated;

comment on function public.record_stripe_invoice_event(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  boolean,
  integer,
  integer,
  text,
  boolean,
  text,
  text,
  integer,
  jsonb,
  jsonb,
  text,
  text,
  timestamptz,
  timestamptz,
  jsonb
) is
  'Service-role RPC for Stripe webhook handlers. Records the Stripe event and upserts billing_invoices in one transaction.';

create or replace function public.record_stripe_payment_event(
  p_stripe_event_id text,
  p_event_type text,
  p_object_id text,
  p_payload jsonb,
  p_stripe_payment_intent_id text,
  p_stripe_customer_id text,
  p_status text,
  p_amount integer,
  p_currency text,
  p_latest_charge_id text,
  p_receipt_email text,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_user_id uuid;
begin
  if exists (
    select 1
    from public.billing_events
    where stripe_event_id = p_stripe_event_id
  ) then
    return 'duplicate';
  end if;

  select user_id
    into customer_user_id
  from public.billing_customers
  where stripe_customer_id = p_stripe_customer_id;

  if customer_user_id is null then
    raise exception 'No billing customer mapping for Stripe customer %', p_stripe_customer_id
      using errcode = 'P0001';
  end if;

  insert into public.billing_events (
    stripe_event_id,
    event_type,
    object_id,
    payload
  ) values (
    p_stripe_event_id,
    p_event_type,
    p_object_id,
    p_payload
  );

  insert into public.billing_payments (
    stripe_payment_intent_id,
    user_id,
    stripe_customer_id,
    status,
    amount,
    currency,
    latest_charge_id,
    receipt_email,
    metadata,
    updated_at
  ) values (
    p_stripe_payment_intent_id,
    customer_user_id,
    p_stripe_customer_id,
    p_status,
    p_amount,
    p_currency,
    p_latest_charge_id,
    p_receipt_email,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (stripe_payment_intent_id) do update set
    user_id = excluded.user_id,
    stripe_customer_id = excluded.stripe_customer_id,
    status = excluded.status,
    amount = excluded.amount,
    currency = excluded.currency,
    latest_charge_id = excluded.latest_charge_id,
    receipt_email = excluded.receipt_email,
    metadata = excluded.metadata,
    updated_at = now();

  insert into public.billing_orders (
    order_key,
    user_id,
    stripe_customer_id,
    stripe_payment_intent_id,
    stripe_charge_id,
    status,
    amount_total,
    amount_paid,
    currency,
    metadata,
    updated_at
  ) values (
    'payment:' || p_stripe_payment_intent_id,
    customer_user_id,
    p_stripe_customer_id,
    p_stripe_payment_intent_id,
    p_latest_charge_id,
    p_status,
    p_amount,
    case when p_status = 'succeeded' then p_amount else null end,
    p_currency,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (order_key) do update set
    user_id = excluded.user_id,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_payment_intent_id = excluded.stripe_payment_intent_id,
    stripe_charge_id = excluded.stripe_charge_id,
    status = excluded.status,
    amount_total = excluded.amount_total,
    amount_paid = excluded.amount_paid,
    currency = excluded.currency,
    metadata = excluded.metadata,
    updated_at = now();

  return 'recorded';
exception
  when unique_violation then
    return 'duplicate';
end;
$$;

revoke all on function public.record_stripe_payment_event(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  integer,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;

comment on function public.record_stripe_payment_event(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  integer,
  text,
  text,
  text,
  jsonb
) is
  'Service-role RPC for Stripe webhook handlers. Records the Stripe event and upserts billing_payments in one transaction.';

create or replace function public.record_stripe_refund_event(
  p_stripe_event_id text,
  p_event_type text,
  p_object_id text,
  p_payload jsonb,
  p_stripe_charge_id text,
  p_stripe_customer_id text,
  p_stripe_payment_intent_id text,
  p_refunded boolean,
  p_amount integer,
  p_amount_refunded integer,
  p_currency text,
  p_receipt_url text,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_user_id uuid;
begin
  if exists (
    select 1
    from public.billing_events
    where stripe_event_id = p_stripe_event_id
  ) then
    return 'duplicate';
  end if;

  select user_id
    into customer_user_id
  from public.billing_customers
  where stripe_customer_id = p_stripe_customer_id;

  if customer_user_id is null then
    raise exception 'No billing customer mapping for Stripe customer %', p_stripe_customer_id
      using errcode = 'P0001';
  end if;

  insert into public.billing_events (
    stripe_event_id,
    event_type,
    object_id,
    payload
  ) values (
    p_stripe_event_id,
    p_event_type,
    p_object_id,
    p_payload
  );

  insert into public.billing_refunds (
    stripe_charge_id,
    user_id,
    stripe_customer_id,
    stripe_payment_intent_id,
    refunded,
    amount,
    amount_refunded,
    currency,
    receipt_url,
    metadata,
    updated_at
  ) values (
    p_stripe_charge_id,
    customer_user_id,
    p_stripe_customer_id,
    p_stripe_payment_intent_id,
    coalesce(p_refunded, false),
    p_amount,
    p_amount_refunded,
    p_currency,
    p_receipt_url,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (stripe_charge_id) do update set
    user_id = excluded.user_id,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_payment_intent_id = excluded.stripe_payment_intent_id,
    refunded = excluded.refunded,
    amount = excluded.amount,
    amount_refunded = excluded.amount_refunded,
    currency = excluded.currency,
    receipt_url = excluded.receipt_url,
    metadata = excluded.metadata,
    updated_at = now();

  insert into public.billing_orders (
    order_key,
    user_id,
    stripe_customer_id,
    stripe_payment_intent_id,
    stripe_charge_id,
    status,
    amount_total,
    amount_refunded,
    currency,
    metadata,
    updated_at
  ) values (
    case
      when p_stripe_payment_intent_id is not null then 'payment:' || p_stripe_payment_intent_id
      else 'charge:' || p_stripe_charge_id
    end,
    customer_user_id,
    p_stripe_customer_id,
    p_stripe_payment_intent_id,
    p_stripe_charge_id,
    case when coalesce(p_refunded, false) then 'refunded' else 'refund_pending' end,
    p_amount,
    p_amount_refunded,
    p_currency,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (order_key) do update set
    user_id = excluded.user_id,
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_payment_intent_id = coalesce(excluded.stripe_payment_intent_id, billing_orders.stripe_payment_intent_id),
    stripe_charge_id = excluded.stripe_charge_id,
    status = excluded.status,
    amount_total = coalesce(billing_orders.amount_total, excluded.amount_total),
    amount_refunded = excluded.amount_refunded,
    currency = excluded.currency,
    metadata = excluded.metadata,
    updated_at = now();

  return 'recorded';
exception
  when unique_violation then
    return 'duplicate';
end;
$$;

revoke all on function public.record_stripe_refund_event(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  boolean,
  integer,
  integer,
  text,
  text,
  jsonb
) from public, anon, authenticated;

comment on function public.record_stripe_refund_event(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  boolean,
  integer,
  integer,
  text,
  text,
  jsonb
) is
  'Service-role RPC for Stripe webhook handlers. Records the Stripe event and upserts billing_refunds in one transaction.';

create or replace function public.record_stripe_dispute_event(
  p_stripe_event_id text,
  p_event_type text,
  p_object_id text,
  p_payload jsonb,
  p_stripe_dispute_id text,
  p_stripe_charge_id text,
  p_stripe_payment_intent_id text,
  p_status text,
  p_reason text,
  p_amount integer,
  p_currency text,
  p_created_at timestamptz,
  p_evidence_due_by timestamptz,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_user_id uuid;
  matched_customer_id text;
begin
  if exists (
    select 1
    from public.billing_events
    where stripe_event_id = p_stripe_event_id
  ) then
    return 'duplicate';
  end if;

  select user_id, stripe_customer_id
    into matched_user_id, matched_customer_id
  from public.billing_orders
  where stripe_charge_id = p_stripe_charge_id
     or (
       p_stripe_payment_intent_id is not null
       and stripe_payment_intent_id = p_stripe_payment_intent_id
     )
  order by updated_at desc
  limit 1;

  if matched_customer_id is null then
    select user_id, stripe_customer_id
      into matched_user_id, matched_customer_id
    from public.billing_refunds
    where stripe_charge_id = p_stripe_charge_id
    limit 1;
  end if;

  if matched_customer_id is null then
    select user_id, stripe_customer_id
      into matched_user_id, matched_customer_id
    from public.billing_payments
    where latest_charge_id = p_stripe_charge_id
       or (
         p_stripe_payment_intent_id is not null
         and stripe_payment_intent_id = p_stripe_payment_intent_id
       )
    limit 1;
  end if;

  insert into public.billing_events (
    stripe_event_id,
    event_type,
    object_id,
    payload
  ) values (
    p_stripe_event_id,
    p_event_type,
    p_object_id,
    p_payload
  );

  insert into public.billing_disputes (
    stripe_dispute_id,
    user_id,
    stripe_customer_id,
    stripe_charge_id,
    stripe_payment_intent_id,
    status,
    reason,
    amount,
    currency,
    disputed_at,
    evidence_due_by,
    metadata,
    updated_at
  ) values (
    p_stripe_dispute_id,
    matched_user_id,
    matched_customer_id,
    p_stripe_charge_id,
    p_stripe_payment_intent_id,
    p_status,
    p_reason,
    p_amount,
    p_currency,
    p_created_at,
    p_evidence_due_by,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (stripe_dispute_id) do update set
    user_id = coalesce(excluded.user_id, billing_disputes.user_id),
    stripe_customer_id = coalesce(excluded.stripe_customer_id, billing_disputes.stripe_customer_id),
    stripe_charge_id = coalesce(excluded.stripe_charge_id, billing_disputes.stripe_charge_id),
    stripe_payment_intent_id = coalesce(
      excluded.stripe_payment_intent_id,
      billing_disputes.stripe_payment_intent_id
    ),
    status = excluded.status,
    reason = excluded.reason,
    amount = excluded.amount,
    currency = excluded.currency,
    disputed_at = excluded.disputed_at,
    evidence_due_by = excluded.evidence_due_by,
    metadata = excluded.metadata,
    updated_at = now();

  return 'recorded';
exception
  when unique_violation then
    return 'duplicate';
end;
$$;

revoke all on function public.record_stripe_dispute_event(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  integer,
  text,
  timestamptz,
  timestamptz,
  jsonb
) from public, anon, authenticated;

comment on function public.record_stripe_dispute_event(
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  integer,
  text,
  timestamptz,
  timestamptz,
  jsonb
) is
  'Service-role RPC for Stripe webhook handlers. Records the Stripe event and upserts billing_disputes in one transaction.';

alter table public.billing_customers enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_entitlements enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_tax_summaries enable row level security;
alter table public.billing_usage_summaries enable row level security;
alter table public.billing_payments enable row level security;
alter table public.billing_refunds enable row level security;
alter table public.billing_disputes enable row level security;
alter table public.billing_orders enable row level security;
alter table public.billing_events enable row level security;

drop policy if exists "billing_customers_select_own" on public.billing_customers;
create policy "billing_customers_select_own"
  on public.billing_customers
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "billing_subscriptions_select_own" on public.billing_subscriptions;
create policy "billing_subscriptions_select_own"
  on public.billing_subscriptions
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "billing_entitlements_select_own" on public.billing_entitlements;
create policy "billing_entitlements_select_own"
  on public.billing_entitlements
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "billing_invoices_select_own" on public.billing_invoices;
create policy "billing_invoices_select_own"
  on public.billing_invoices
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "billing_tax_summaries_select_own" on public.billing_tax_summaries;
create policy "billing_tax_summaries_select_own"
  on public.billing_tax_summaries
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "billing_usage_summaries_select_own" on public.billing_usage_summaries;
create policy "billing_usage_summaries_select_own"
  on public.billing_usage_summaries
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "billing_payments_select_own" on public.billing_payments;
create policy "billing_payments_select_own"
  on public.billing_payments
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "billing_refunds_select_own" on public.billing_refunds;
create policy "billing_refunds_select_own"
  on public.billing_refunds
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "billing_disputes_select_own" on public.billing_disputes;
create policy "billing_disputes_select_own"
  on public.billing_disputes
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "billing_orders_select_own" on public.billing_orders;
create policy "billing_orders_select_own"
  on public.billing_orders
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No client-facing policy is created for billing_events. Webhook handlers should
-- insert into billing_events with the service role key and should use
-- `stripe_event_id` as the idempotency guard.
