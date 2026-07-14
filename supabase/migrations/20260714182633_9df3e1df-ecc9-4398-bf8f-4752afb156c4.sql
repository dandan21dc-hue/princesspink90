-- Add audit_admin role for gating quarantine/flag actions
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'audit_admin';