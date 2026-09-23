from typing import Any


class HubError(Exception):
    """An error with an HTTP status, returned as {"error": {"code", "message", "details"?}}."""

    def __init__(self, status: int, code: str, message: str, details: Any = None, headers: dict | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details
        self.headers = headers

    def body(self) -> dict:
        err: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details is not None:
            err["details"] = self.details
        return {"error": err}


def from_validation_error(exc) -> HubError:
    """Turn a pydantic ValidationError into a readable 400."""
    details = []
    for e in exc.errors():
        loc = ".".join(str(p) for p in e["loc"] if p not in ("body",))
        msg = e["msg"].removeprefix("Value error, ")
        details.append({"field": loc, "message": msg})
    first = details[0] if details else {"field": "", "message": "invalid request"}
    summary = f"{first['field']}: {first['message']}" if first["field"] else first["message"]
    return HubError(400, "invalid_request", summary, details=details)
