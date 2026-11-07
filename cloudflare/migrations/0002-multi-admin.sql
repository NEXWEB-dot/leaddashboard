/* Additive migration: allow multiple admins and admin invitations */
DROP INDEX IF EXISTS users_one_admin;
