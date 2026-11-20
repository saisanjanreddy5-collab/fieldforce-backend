// Rule A (hierarchy-based visibility): a record is visible to its owner and to
// everyone above the owner in the reporting chain. Walking UP from each
// record's owner would need one query per record, so instead this walks DOWN
// from the requesting user ($1) to their entire subtree (themselves + every
// direct/indirect report). A record is visible via Rule A exactly when its
// owner is somewhere in that subtree - equivalent to "the requesting user is
// on the owner's upward chain". Admin gets no special treatment here; callers
// that give Admin a company-wide view add their own admin clause or use
// ADMIN_AWARE_SUBTREE_CTE below.
export const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

// Same as SUBTREE_CTE, except an Admin's subtree is the whole company. Admin
// is a company-wide role, not a node in the reporting chain: two Admins in
// different branches (or one with nobody reporting to them) must see the
// same numbers, exactly as leads/opportunities/quotes already treat Admins.
// Exposes the same CTE name `subtree`.
export const ADMIN_AWARE_SUBTREE_CTE = `
  WITH RECURSIVE reporting_tree AS (
    SELECT id FROM users WHERE id = $1
    UNION
    SELECT u.id FROM users u INNER JOIN reporting_tree t ON u.manager_id = t.id
  ),
  subtree AS (
    SELECT id FROM reporting_tree
    UNION
    SELECT u.id FROM users u WHERE EXISTS (SELECT 1 FROM users ru WHERE ru.id = $1 AND ru.role = 'admin')
  )
`;
