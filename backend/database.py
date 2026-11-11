"""Small PostgreSQL adapter for prepared ticket records."""
from contextlib import contextmanager

import pandas as pd


class TicketDatabase:
    def __init__(self, connection_string: str):
        self.connection_string = connection_string

    @contextmanager
    def connection(self):
        import psycopg

        with psycopg.connect(self.connection_string) as connection:
            yield connection

    def tickets(self, status: str, offset: int, limit: int) -> pd.DataFrame:
        clauses = []
        params = []
        if status == "open":
            clauses.append("status IS DISTINCT FROM 'Closed'")
        elif status == "closed":
            clauses.append("status = 'Closed'")
        where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
        query = f"""
            SELECT objectid, month, requested_datetime, expected_datetime,
                   closed_datetime, status, service_notice, resolution_days,
                   service_backlog, split, delayed, service_name,
                   agency_responsible, zipcode, sla_business_days,
                   day_of_week, prior_7d_service_volume, prior_7d_zip_volume,
                   backlog_share, request_id, source
            FROM tickets
            {where}
            ORDER BY requested_datetime DESC, objectid
            LIMIT %s OFFSET %s
        """
        params.extend((limit, offset))
        with self.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(query, params)
                rows = cursor.fetchall()
                columns = [column.name for column in cursor.description]
        frame = pd.DataFrame(rows, columns=columns)
        for column in ("requested_datetime", "expected_datetime", "closed_datetime"):
            if column in frame:
                frame[column] = pd.to_datetime(frame[column], errors="coerce")
        if not frame.empty:
            frame["objectid"] = frame["objectid"].astype(str)
            frame["request_id"] = frame["request_id"].fillna(
                "PHL-" + frame["objectid"])
        return frame

    def count(self, status: str) -> int:
        condition = ""
        if status == "open":
            condition = " WHERE status IS DISTINCT FROM 'Closed'"
        elif status == "closed":
            condition = " WHERE status = 'Closed'"
        with self.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(f"SELECT COUNT(*) FROM tickets{condition}")
                return int(cursor.fetchone()[0])

    def ticket(self, request_id: str) -> pd.DataFrame:
        with self.connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT * FROM tickets WHERE request_id = %s",
                    (request_id,),
                )
                rows = cursor.fetchall()
                columns = [column.name for column in cursor.description]
        frame = pd.DataFrame(rows, columns=columns)
        for column in ("requested_datetime", "expected_datetime", "closed_datetime"):
            if column in frame:
                frame[column] = pd.to_datetime(frame[column], errors="coerce")
        return frame
