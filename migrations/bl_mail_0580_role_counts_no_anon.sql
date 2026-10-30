-- bl_mail_0580 — cc_mail_role_counts was anon-executable (prod anon SECURITY DEFINER count 37 vs baseline 36).
-- It checks comm.view inside, but CLAUDE.md §4 keeps the anon surface to the documented list. Back to 36.
revoke all on function public.cc_mail_role_counts(text) from public, anon;
grant execute on function public.cc_mail_role_counts(text) to authenticated;
