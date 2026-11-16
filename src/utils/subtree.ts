// "Everyone whose records the requesting user ($1) can see": themselves plus
// everyone reporting up to them - except an Admin, who sees the whole
// company. Admin is a company-wide role, not a node in the reporting chain:
// two Admins in different branches (or one with nobody reporting to them)
// must see the same numbers, exactly as leads/opportunities/quotes already
// treat Admins. Exposes the CTE name `subtree` so it drops in wherever the
// plain reporting-line version was used.
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
