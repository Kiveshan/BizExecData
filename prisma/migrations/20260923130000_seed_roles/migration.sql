-- Reference data the app depends on: registration assigns roleid 4 and the
-- dashboard routes on roleid 1-4, but these rows were never part of a
-- migration, so a freshly created database rejected every registration.
-- Names match production exactly (including trailing spaces). No-op on
-- databases that already have them.
INSERT INTO "roles" ("roleid", "rolename") VALUES
    (1, 'business_manager '),
    (2, 'business_owner'),
    (3, 'system_administrator '),
    (4, 'Excel')
ON CONFLICT ("roleid") DO NOTHING;

-- Keep the serial ahead of the explicit ids.
SELECT setval(pg_get_serial_sequence('roles', 'roleid'), GREATEST((SELECT MAX("roleid") FROM "roles"), 1));
