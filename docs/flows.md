# Musabe Application Flows

This document describes the exact work flows that Version 1.0 must support.
It is the practical companion to `roadmap.md`.

---

## 1. Login & Session

1. User opens the login page.
2. Enters email + password.
3. Optional: ticks **Remember me**.
4. On success → lands on the dashboard (role-based sidebar appears).
5. If the account has `must_change_password = true` → forced change-password screen first.
6. **Forgot password**:
   - User submits email.
   - System always shows the same success message.
   - Admin is notified and sets a temporary password.
   - User logs in with temporary password and is forced to change it.

---

## 2. SuperAdmin / Admin – Register Staff & Branches

Nothing else works until branches and staff exist.

### 2.1 Register school branches
1. Admin (Central) creates each branch:
   - Nursery & Primary (type: Primary)
   - Girls Secondary (type: Secondary)
   - Boys Secondary (type: Secondary)
2. Central Administration is treated as a special place (not a school branch).

### 2.2 Register staff
1. Admin enters:
   - Full name
   - Email
   - Temporary password
2. Admin assigns:
   - **Role** (Admin, Manager, Bursar, Storekeeper, Head Master/Mistress, Academic Master, Librarian, Requesting Staff)
   - **Place**:
     - One specific branch
     - Several branches
     - Central Administration only
     - Across all
3. Staff member logs in → forced password change → sees only the sidebar items allowed by their role.

### 2.3 Other Admin actions
- Reset any staff member’s password (temporary + forced change)
- Activate / deactivate account
- View login activity / audit log

---

## 3. Library / Store – Request to Write-off

The system follows **one item** from the first request to the final write-off.
Central Administration and the school work together at each stage.

### High-level stages (9 stages)

| Stage | Where | Who | Action |
|-------|-------|-----|--------|
| 1. Request | School | Requesting Staff | Sees a need and raises a request |
| 2. School approval | School | Academic Master → Head Master | Academic Master reviews (especially textbooks); Head Master gives final school approval |
| 3. Requisition | School | Librarian | Turns approved request into a Purchase Requisition and sends it to Central |
| 4. Central approval | Central | Bursar → Manager | Bursar prepares Purchase Order; Manager gives final approval |
| 5. Order & receive | Central | Storekeeper | Orders from supplier; receives delivery (supplier never delivers straight to the school) |
| 6. Verify & pay | Central | Original Requestor → Bursar | Requestor checks items against original request; only then Bursar pays |
| 7. Catalogue | School | Librarian | Gives each book a unique code; status = Available |
| 8. Issue & track | School | Librarian | Issues items; every movement is recorded |
| 9. Write-off | School | Librarian → Head Master | Librarian reports loss/damage; Head Master gives final approval |

### Books / Textbooks (longer controlled path – 13 steps)

1. Teacher / Requesting Staff raises request  
2. Academic Master reviews  
3. Head Master approves  
4. Librarian writes Purchase Requisition  
5. Bursar makes Purchase Order  
6. Manager gives final approval  
7. Storekeeper orders from supplier  
8. Supplier delivers to Storekeeper  
9. Original Requestor verifies delivery matches request  
10. Bursar pays supplier  
11. Storekeeper sends books to the school library  
12. Librarian catalogues (unique code)  
13. Issuing begins

### Other items (stationery, uniforms, sewing materials, Primary items – shorter path – 9 steps)

1. Staff member raises request  
2. Academic Master **or** Head Master approves  
3. Librarian receives the approved request  
4. Request goes through Bursar to Manager for approval  
5. Storekeeper orders from supplier  
6. Supplier delivers to Storekeeper  
7. Original Requestor checks items  
8. Bursar pays  
9. Items move to school store; Librarian issues them

**Rules that never change**
- Storekeeper is the **only** receiving point from suppliers.
- Payment happens **only after** the original requestor verifies the delivery.
- Only the Librarian issues items.
- Every movement in and out is recorded.

### Parent contributions (Primary only)
- Librarian records items given by parents (soap, toothpaste, etc.) as an extra stock-in path.

---

## 4. Sidebar by Role (what each person sees)

| Role | Typical sidebar items |
|------|-----------------------|
| Admin | Branches, Staff, Reset requests, Login activity, Settings |
| Manager | Pending approvals, Purchase Orders, Reports |
| Bursar | Requisitions → POs, Payments, Reports |
| Storekeeper | Orders, Receiving, Send to schools |
| Head Master / Headmistress | School requests (approve), Write-offs (approve), Reports |
| Academic Master | Incoming requests (review/filter), Reports |
| Librarian | Requests, Requisitions, Catalogue, Issue, Write-off, Stock, Parent contributions |
| Requesting Staff | Raise request, My requests, Verify deliveries |

The exact menu items will be refined when the dashboard shell is built, but the principle is strict role-based visibility.

---

## 5. Version 1.0 boundary

Version 1.0 stops at:
- Staff & branch registration
- Full request → approval → buy → receive → verify → catalogue → issue → write-off
- Basic stock control and audit trail

Version 1.1 will add students, parents and the link to the library.
