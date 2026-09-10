import { pool } from "../config/db";
import { ApiError } from "../utils/ApiError";
import { totalPathDistanceKm } from "../utils/geo";

// A user's own attendance is visible to themselves and to everyone above
// them in their reporting chain - the same Rule A idea used for leads.
const SUBTREE_CTE = `
  WITH RECURSIVE subtree AS (
    SELECT id FROM users WHERE id = $1
    UNION ALL
    SELECT u.id FROM users u INNER JOIN subtree s ON u.manager_id = s.id
  )
`;

interface AttendanceRow {
  id: string;
  user_id: string;
  check_in_at: string;
  check_in_latitude: string | null;
  check_in_longitude: string | null;
  check_out_at: string | null;
  check_out_latitude: string | null;
  check_out_longitude: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface LocationPingRow {
  latitude: string;
  longitude: string;
  captured_at: string;
}

export interface CheckInOutInput {
  latitude?: number;
  longitude?: number;
}

function toPublicAttendance(row: AttendanceRow) {
  return {
    id: row.id,
    userId: row.user_id,
    checkInAt: row.check_in_at,
    checkInLatitude: row.check_in_latitude === null ? null : Number(row.check_in_latitude),
    checkInLongitude: row.check_in_longitude === null ? null : Number(row.check_in_longitude),
    checkOutAt: row.check_out_at,
    checkOutLatitude: row.check_out_latitude === null ? null : Number(row.check_out_latitude),
    checkOutLongitude: row.check_out_longitude === null ? null : Number(row.check_out_longitude),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function checkIn(userId: string, input: CheckInOutInput) {
  const openRecord = await pool.query("SELECT id FROM attendance WHERE user_id = $1 AND status = 'checked_in'", [
    userId,
  ]);
  if ((openRecord.rowCount ?? 0) > 0) {
    throw new ApiError(409, "Already checked in - check out first before checking in again");
  }

  const result = await pool.query<AttendanceRow>(
    `INSERT INTO attendance (user_id, check_in_latitude, check_in_longitude)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, input.latitude ?? null, input.longitude ?? null]
  );

  return toPublicAttendance(result.rows[0]);
}

export async function checkOut(userId: string, input: CheckInOutInput) {
  const result = await pool.query<AttendanceRow>(
    `UPDATE attendance
     SET check_out_at = now(), check_out_latitude = $1, check_out_longitude = $2, status = 'checked_out', updated_at = now()
     WHERE user_id = $3 AND status = 'checked_in'
     RETURNING *`,
    [input.latitude ?? null, input.longitude ?? null, userId]
  );

  if (result.rows.length === 0) {
    throw new ApiError(409, "Not currently checked in");
  }

  return toPublicAttendance(result.rows[0]);
}

export async function getStatus(userId: string) {
  const result = await pool.query<AttendanceRow>(
    "SELECT * FROM attendance WHERE user_id = $1 ORDER BY check_in_at DESC LIMIT 1",
    [userId]
  );

  if (result.rows.length === 0) {
    return { status: "never_checked_in" as const, attendance: null };
  }

  return { status: result.rows[0].status, attendance: toPublicAttendance(result.rows[0]) };
}

export async function getMyHistory(userId: string) {
  const result = await pool.query<AttendanceRow>(
    "SELECT * FROM attendance WHERE user_id = $1 ORDER BY check_in_at DESC LIMIT 100",
    [userId]
  );
  return result.rows.map(toPublicAttendance);
}

async function isUserInRequesterSubtree(targetUserId: string, requestingUserId: string): Promise<boolean> {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT 1 FROM subtree WHERE id = $2`,
    [requestingUserId, targetUserId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getUserHistory(targetUserId: string, requestingUserId: string) {
  const allowed = await isUserInRequesterSubtree(targetUserId, requestingUserId);
  if (!allowed) {
    throw new ApiError(403, "You do not have access to this user's attendance");
  }

  const result = await pool.query<AttendanceRow>(
    "SELECT * FROM attendance WHERE user_id = $1 ORDER BY check_in_at DESC LIMIT 100",
    [targetUserId]
  );
  return result.rows.map(toPublicAttendance);
}

export async function getTeamStatus(requestingUserId: string) {
  const result = await pool.query(
    `${SUBTREE_CTE}
     SELECT
       u.id AS "userId",
       u.name,
       u.email,
       latest.status,
       latest.check_in_at AS "checkInAt",
       latest.check_out_at AS "checkOutAt"
     FROM subtree s
     JOIN users u ON u.id = s.id
     LEFT JOIN LATERAL (
       SELECT status, check_in_at, check_out_at
       FROM attendance a
       WHERE a.user_id = u.id
       ORDER BY a.check_in_at DESC
       LIMIT 1
     ) latest ON true
     WHERE u.id <> $1
     ORDER BY u.name`,
    [requestingUserId]
  );

  return result.rows;
}

export async function getAttendanceById(id: string, requestingUserId: string) {
  const result = await pool.query<AttendanceRow>("SELECT * FROM attendance WHERE id = $1", [id]);
  if (result.rows.length === 0) {
    throw new ApiError(404, "Attendance record not found");
  }

  const allowed = await isUserInRequesterSubtree(result.rows[0].user_id, requestingUserId);
  if (!allowed) {
    throw new ApiError(403, "You do not have access to this attendance record");
  }

  return toPublicAttendance(result.rows[0]);
}

export async function recordLocationPing(userId: string, latitude: number, longitude: number): Promise<void> {
  const openRecord = await pool.query("SELECT id FROM attendance WHERE user_id = $1 AND status = 'checked_in'", [
    userId,
  ]);
  if ((openRecord.rowCount ?? 0) === 0) {
    throw new ApiError(409, "Cannot record location - not currently checked in");
  }

  await pool.query("INSERT INTO location_pings (user_id, latitude, longitude) VALUES ($1, $2, $3)", [
    userId,
    latitude,
    longitude,
  ]);
}

export async function getDistanceForAttendance(id: string, requestingUserId: string) {
  const attendance = await getAttendanceById(id, requestingUserId);

  const result = await pool.query<LocationPingRow>(
    `SELECT latitude, longitude, captured_at FROM location_pings
     WHERE user_id = $1 AND captured_at >= $2 AND captured_at <= $3
     ORDER BY captured_at ASC`,
    [attendance.userId, attendance.checkInAt, attendance.checkOutAt ?? new Date()]
  );

  const points = result.rows.map((row) => ({ latitude: Number(row.latitude), longitude: Number(row.longitude) }));
  const totalDistanceKm = totalPathDistanceKm(points);

  return { attendanceId: id, pointCount: points.length, totalDistanceKm };
}
