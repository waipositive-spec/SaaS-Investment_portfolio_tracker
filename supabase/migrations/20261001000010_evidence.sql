-- 0010_evidence.sql
-- Physical Schema/RLS v0.1, Section 8.
-- MVP1: schema only — no upload UI/workflow until MVP2 (Accounting
-- Readiness decision, 3 Oct 2026). Tables exist now so the Ledger
-- contracts don't need reshaping later.

create table public.evidence_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  storage_bucket text not null default 'accounting-evidence',
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  file_size_bytes bigint not null,
  content_hash_sha256 text not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references public.user_profiles (id),
  source text not null default 'user_upload',
  status text not null default 'active',
  constraint evidence_documents_size_chk check (file_size_bytes > 0)
);
create unique index evidence_documents_tenant_bucket_path_uk
  on public.evidence_documents (tenant_id, storage_bucket, storage_path);
create index evidence_documents_tenant_hash_idx
  on public.evidence_documents (tenant_id, content_hash_sha256);
alter table public.evidence_documents add constraint evidence_documents_id_tenant_uk unique (id, tenant_id);

create table public.transaction_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  document_id uuid not null references public.evidence_documents (id) on delete cascade,
  relationship_type text not null default 'receipt',
  linked_at timestamptz not null default now(),
  linked_by uuid references public.user_profiles (id),
  constraint transaction_evidence_uk unique (transaction_id, document_id)
);
alter table public.transaction_evidence
  add constraint transaction_evidence_transaction_tenant_fk
  foreign key (transaction_id, tenant_id) references public.transactions (id, tenant_id);
alter table public.transaction_evidence
  add constraint transaction_evidence_document_tenant_fk
  foreign key (document_id, tenant_id) references public.evidence_documents (id, tenant_id);
