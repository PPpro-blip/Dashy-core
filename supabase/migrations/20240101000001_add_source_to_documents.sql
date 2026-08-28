-- Add missing source column to documents table

ALTER TABLE public.documents
ADD COLUMN IF NOT EXISTS source TEXT;