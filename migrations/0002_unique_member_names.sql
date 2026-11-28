-- Two current members can't share a name (ignoring case), so nobody can pass as someone else.
CREATE UNIQUE INDEX people_member_name ON people (lower(name)) WHERE kind = 'member' AND removed_at IS NULL;
