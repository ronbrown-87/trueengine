ALTER TABLE public.verifications
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS date_of_issue date,
  ADD COLUMN IF NOT EXISTS place_of_issue text,
  ADD COLUMN IF NOT EXISTS back_document_path text,
  ADD COLUMN IF NOT EXISTS face_descriptor real[],
  ADD COLUMN IF NOT EXISTS id_face_descriptor real[],
  ADD COLUMN IF NOT EXISTS consent jsonb,
  ADD COLUMN IF NOT EXISTS liveness_challenges jsonb;