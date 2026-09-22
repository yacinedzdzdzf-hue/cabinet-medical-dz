import { supabase } from '@/lib/supabase';

export async function logAudit(
  action: string,
  entityType?: string,
  entityId?: string,
  entityDescription?: string,
  details?: Record<string, unknown>,
  actor?: { id?: string | null; name?: string | null },
) {
  try {
    await supabase.from('audit_logs').insert({
      action,
      entity_type: entityType,
      entity_id: entityId,
      entity_description: entityDescription,
      details: details ?? {},
      user_id: actor?.id ?? null,
      user_name: actor?.name ?? null,
    });
  } catch (e) {
    console.error('Audit log failed:', e);
  }
}
