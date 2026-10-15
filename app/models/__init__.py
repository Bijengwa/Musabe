"""ORM models package.

Importing this package registers all models on ``Base.metadata`` so that
Alembic autogenerate and ``create_all`` can discover them.
"""

from app.models.audit import AuditLog
from app.models.branch import Branch, BranchType
from app.models.contribution import ParentContribution
from app.models.inventory import StockItem, StockMovement, StockMovementType
from app.models.issuing import Issue, IssueStatus
from app.models.library import BookCopy, BookCopyStatus, BookTitle
from app.models.procurement import (
    Delivery,
    Payment,
    PurchaseOrder,
    Requisition,
    Supplier,
    Verification,
)
from app.models.request import (
    Approval,
    ApprovalAction,
    Request,
    RequestLine,
    RequestStatus,
    RequestType,
)
from app.models.user import CENTRAL_ROLES, SCHOOL_ROLES, Role, RoleAssignment, User
from app.models.writeoff import WriteOff, WriteOffReason, WriteOffStatus

__all__ = [
    "Approval",
    "ApprovalAction",
    "AuditLog",
    "BookCopy",
    "BookCopyStatus",
    "BookTitle",
    "Branch",
    "BranchType",
    "CENTRAL_ROLES",
    "Delivery",
    "Issue",
    "IssueStatus",
    "ParentContribution",
    "Payment",
    "PurchaseOrder",
    "Request",
    "RequestLine",
    "RequestStatus",
    "RequestType",
    "Requisition",
    "Role",
    "RoleAssignment",
    "SCHOOL_ROLES",
    "StockItem",
    "StockMovement",
    "StockMovementType",
    "Supplier",
    "User",
    "Verification",
    "WriteOff",
    "WriteOffReason",
    "WriteOffStatus",
]
