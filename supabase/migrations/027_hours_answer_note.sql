-- Push 22 (Oct 30): Ronnie's short reason when he answers an hours question (the staff member sees it).
alter table public.hours_questions add column if not exists answer_note text;
select count(*) from information_schema.columns where table_name = 'hours_questions' and column_name = 'answer_note';
