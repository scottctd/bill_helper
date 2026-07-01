# CALLING SPEC:
# - Purpose: translate HTTP requests and responses for `currencies` routes.
# - Inputs: FastAPI dependencies and request principal scope.
# - Outputs: `CurrencyRead` list responses from the currencies service.
# - Side effects: HTTP routing only.
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.auth.contracts import RequestPrincipal
from backend.auth.dependencies import get_current_principal
from backend.database import get_db
from backend.schemas_finance import CurrencyRead
from backend.services.currencies import list_currencies_for_principal

router = APIRouter(prefix="/currencies", tags=["currencies"])


@router.get("", response_model=list[CurrencyRead])
def list_currencies(
    db: Session = Depends(get_db),
    principal: RequestPrincipal = Depends(get_current_principal),
) -> list[CurrencyRead]:
    return list_currencies_for_principal(db, principal=principal)
