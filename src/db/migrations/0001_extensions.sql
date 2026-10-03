-- 0001_extensions.sql
-- Physical Schema/RLS v0.1, Section 1 & 16.
-- pgcrypto gives us gen_random_uuid() for all PK defaults.

create extension if not exists pgcrypto;
