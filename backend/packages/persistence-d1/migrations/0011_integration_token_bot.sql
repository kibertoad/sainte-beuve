-- Whether a stored credential's account is a machine account on its host, read
-- when the credential is stored. GitLab's intake answers comment commands only
-- as a bot, so a person's own token never turns mentions of that person into
-- commands. A row stored before this column reads as a person until it is
-- stored again.
--
-- The Postgres adapter carries the same change as
-- `migrations/20261012112953_keen_malcolm_colcord/migration.sql`.
ALTER TABLE integration_tokens ADD COLUMN subject_is_bot INTEGER NOT NULL DEFAULT 0;
