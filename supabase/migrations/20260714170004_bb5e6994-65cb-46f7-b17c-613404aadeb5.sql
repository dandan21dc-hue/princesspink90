CREATE INDEX IF NOT EXISTS admin_activity_audit_created_at_idx
  ON public.admin_activity_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_audit_resource_created_at_idx
  ON public.admin_activity_audit (resource, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_audit_actor_id_created_at_idx
  ON public.admin_activity_audit (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_audit_action_created_at_idx
  ON public.admin_activity_audit (action, created_at DESC);