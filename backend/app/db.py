"""Database setup. Everything else talks to the DB through a Session from `make_session_factory`,
so switching to Postgres (e.g. Supabase) is just a different DATABASE_URL."""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


class Base(DeclarativeBase):
    pass


def make_session_factory(database_url: str) -> sessionmaker:
    connect_args = {}
    if database_url.startswith("sqlite"):
        # FastAPI runs sync endpoints in a thread pool.
        connect_args["check_same_thread"] = False
        path = database_url.split("///", 1)[-1]
        if path and path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    engine = create_engine(database_url, connect_args=connect_args, pool_pre_ping=True)

    from . import models  # noqa: F401  (register tables)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)
