-- Run once as a database administrator after replacing the placeholders.
-- The API account must not have CREATE, ALTER, DROP, GRANT, FILE or SUPER.
CREATE USER 'pocketlegal_app'@'YOUR_API_PRIVATE_IP' IDENTIFIED BY 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE ON pocket_legal_assistant.* TO 'pocketlegal_app'@'YOUR_API_PRIVATE_IP';
FLUSH PRIVILEGES;

-- Apply schema migrations through a different, short-lived release account.
-- Revoke that account's DDL privileges immediately after each release.
