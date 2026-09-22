/*
# CMDZ — Fix generate_queue_number to handle H-001/F-001 format

The old function tried to CAST(queue_number AS integer) which fails
because queue_number is stored as 'H-001' format.
Fix: extract the numeric suffix after the dash.
*/

CREATE OR REPLACE FUNCTION public.generate_queue_number(p_queue_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_num integer;
  new_number text;
  lock_key bigint;
  current_max integer;
BEGIN
  -- Use advisory lock to prevent race conditions
  lock_key := CASE WHEN p_queue_type = 'H' THEN 1001 ELSE 1002 END;
  
  PERFORM pg_advisory_xact_lock(lock_key);
  
  -- Extract the numeric part from queue_number (format: 'H-001' -> 1)
  SELECT COALESCE(MAX(CAST(SUBSTRING(queue_number FROM 3) AS integer)), 0) + 1
  INTO next_num
  FROM public.waiting_queue
  WHERE queue_type = p_queue_type;
  
  new_number := p_queue_type || '-' || lpad(next_num::text, 3, '0');
  
  RETURN new_number;
END;
$$;
