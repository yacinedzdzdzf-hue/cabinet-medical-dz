/*
# CMDZ — Number generation RPCs for billing

Creates helper functions to generate sequential invoice, payment, and receipt numbers.
Used by the frontend billing pages.
*/

CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE next_num integer; new_number text;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM 5) AS integer)), 0) + 1
  INTO next_num FROM public.invoices WHERE invoice_number LIKE 'FAC-%';
  new_number := 'FAC-' || lpad(next_num::text, 6, '0');
  RETURN new_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_payment_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE next_num integer; new_number text;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(payment_number FROM 5) AS integer)), 0) + 1
  INTO next_num FROM public.payments WHERE payment_number LIKE 'PAY-%';
  new_number := 'PAY-' || lpad(next_num::text, 6, '0');
  RETURN new_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_receipt_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE next_num integer; new_number text;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(receipt_number FROM 4) AS integer)), 0) + 1
  INTO next_num FROM public.receipts WHERE receipt_number LIKE 'REC-%';
  new_number := 'REC-' || lpad(next_num::text, 6, '0');
  RETURN new_number;
END;
$$;
