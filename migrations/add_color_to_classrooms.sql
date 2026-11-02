-- migrations/add_color_to_classrooms.sql
-- Adds color column to classrooms table for theme color persistence

ALTER TABLE classrooms 
ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#FF6B00';

COMMENT ON COLUMN classrooms.color IS 'Theme color hex code for classroom card and branding banner';
