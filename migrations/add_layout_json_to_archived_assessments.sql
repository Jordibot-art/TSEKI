-- migrations/add_layout_json_to_archived_assessments.sql
-- Tseki Print Engine: Adds layout_json to archived_assessments table
-- Stores pixel-precise bounding box coordinates from pdf-lib layout engine
-- Used by the camera GraderTab for optical OCR bounding box alignment

ALTER TABLE archived_assessments
ADD COLUMN IF NOT EXISTS layout_json JSONB DEFAULT NULL;

COMMENT ON COLUMN archived_assessments.layout_json IS 'Exact physical bounding box coordinates of all answer boxes and registration markers for camera OCR grading';
