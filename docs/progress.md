# Musabe Progress

Plan: `docs/roadmap.md`. Tick a box only when its "Done when" check passes.

Current step: **2 — Library & Sales** (all parts built 2026-11-14; next: go live in English Medium beside the Excel book).

## Step 1a — Accounts ✅
- [x] Backend: Express 5 + Knex + PostgreSQL, `/api/health`
- [x] Migration `20261110_001_core_accounts`: schools, users, sessions, audit_log
- [x] Seed: 3 schools + first Super Admin (temporary password)
- [x] Sign in / sign out, "keep me signed in", lock after 5 wrong passwords
- [x] Forced password change after a temporary password
- [x] Forgot password → request shows on the administrator's Home
- [x] One permissions file (`backend/src/auth/roles.js`) for sidebar + API
- [x] Staff accounts: create, edit, reset password, switch on/off (Super Admin, School Admin)
- [x] Schools page (Super Admin adds/edits)
- [x] Audit log page
- [x] Shell: role sidebar, hamburger (drawer on phone, icon rail on computer), school filter for administration
- [x] Tested: 36 API checks + browser run Super Admin → School Admin → Bursar

## Step 1a+ — My account (profile & settings) ✅
- [x] Migration `20261111_002_profile_settings`: users.email, users.preferences
- [x] API `/api/me`: profile, edit phone/email (name, username, role, school locked), preferences, devices
- [x] My profile page: locked details, contact edit, account facts, my recent activity
- [x] Settings page: Light/Dark/System, text size, change password, devices (sign out one / all others), sign out
- [x] Top-right menu: profile, settings, quick theme, sign out. Name card in sidebar opens profile
- [x] Tested: API checks + browser run (desktop and phone, light and dark)

## Real time ✅
- [x] `backend/src/realtime.js`: Server-Sent Events at `/api/events` + PostgreSQL LISTEN/NOTIFY (works with several server processes)
- [x] Every `audit()` call publishes a change ("audit" + area, e.g. `user`, `school`, later `stock`, `receipt`), so new modules are live automatically
- [x] Only people allowed to see a change are told (their school, administration, or the people involved); the message has no data
- [x] Instant sign-out when an account is switched off, password reset, or a device is signed out
- [x] Theme and profile changes follow the person to all their open devices
- [x] Frontend `src/live.js`: `useLive(['user'], load)` on each screen; "Live" dot in the top bar
- [x] Tested with 3 browsers: staff list, theme sync, school scoping, rename, switch-off, remote sign-out

## Step 1b — Students ✅
Agreed 2026-11-13: the Admission No. is the student's number (unique per school); the school names its own classes and streams; one Excel file per class (choose the class, then upload).
- [x] Migration 008: `classes` (name + optional stream, order, on/off), `students` (admission no., first/middle/last, sex, class, parent, phone, at school / left), `student_imports`; receipts.student_id now points to a student
- [x] School Admin (own school) and Super Admin (school chosen at the top): classes, add / edit / move / mark as left; others view only. Students are never deleted
- [x] Excel class list: the school's own files work as they are (columns found by name, title rows and fee columns ignored, first sheet only). Review page: mistakes in red with row number (block approval), warnings in yellow (bad phone saved empty, same name with another admission no.), new / update / move / back at school. Empty cells never erase saved data
- [x] Rows moved one row down (Sex and Parent columns slipped, as in P.IV.xlsx) are found and must be fixed or ticked as checked before approval
- [x] Phones cleaned: 759426581 → 0759426581, 0768-279191 → 0768279191; wrong ones are not saved
- [x] Student search (`/api/students/search`): words in any order or admission no.; Sell picks the student from a list that changes as you type; name, class and sex (for boy/girl prices) come from the list. "Not in the list" lets the bursar type a name for now
- [x] Tests: `test/students.test.js` (10) + run with the school's real P.2 and P.IV files
- [x] Migration 009 (2026-11-13): classes have a full name and a short name (PRIMARY ONE = P 1) + optional stream; lists sort by the short name (no "order" field); receipts and lists show the short name, e.g. P 2 A
- [x] Sidebar group "Students": Students · Add student · Upload class list · Move / promote · Classes (view-only roles see only Students and Classes)
- [x] Student page (`/students/:id`): details, receipts with items, history of every change, edit, move class, left school / back, Previous / Next through the class (also ← → keys)
- [x] Add student warns when a similar name is already saved; "Save and add another" keeps the class
- [x] Migration 010: PREM number removed (not used by the school); a PREM column in Excel is ignored
- [x] Move / promote: tick students of a class, move them to another class or mark them as left school (end of year: start from the top class)

## Notifications (2026-11-13)
- [x] Each role is told only what concerns its work (`backend/src/lib/notify.js`): bursar = price changes in own school; librarian = new receipts and late ones in own school + prices; finance = prices, late receipts, item uploads to approve (FM/AFM); School Admin / Super Admin = staff account requests; Head Master = own school's prices, late receipts, class lists loaded. Nobody is told about their own actions. The Activity page still keeps the full record

## Step 2 — Library & Sales
Agreed 2026-11-11:
- Working accounts: Finance Manager, Assistant Finance Manager, Accountant, Assistant Accountant, Bursar (each school), Librarian (each school). Director/Manager/Head Master view only.
- Damaged/lost: only Finance Manager and Accountant approve.
- Items: Finance Manager creates items and prices; they can be sold at once (no approval step).
- Sending stock: Accountant and the Finance office (FM + Assistant FM). Later a Store-keeper role receives from suppliers and sends to libraries.
- Payment: always the full amount.
- Accountant: watches bursar receipts live with alerts when receipts wait too long (e.g. paid but items not given), confirms each bursar's daily money (received/banked), approves damaged/lost, reports and Excel export.
- [x] Items & prices (migration 004, seed 02): one item list, a price per school or "not sold", boys/girls prices, price history, stop/start selling, live
- [x] Excel: download on every list (`lib/excel.js`, exceljs); items & prices upload with template, check-before-save and row mistakes
- [x] Activity page (was Audit log): filter by area (Library, Accounts, Schools, Academic), role, dates, words; Excel; who sees which area in `lib/activity.js`
- [x] Notifications (migration 005): bell with unread count, sound (Settings → on/off, test), pop-ups when the app is in the background, live
- [x] Send stock / confirm delivery (migration 012, `routes/stock.js`, `pages/SendStock.jsx`, `pages/Incoming.jsx`): FM, AFM, Accountant send DLV.0001… to a school (form or Excel upload); the librarian confirms each line with what really arrived (fewer = note, finance told); stock goes up only then; cancel only before any line is confirmed
- [x] Sell + receipt (migration 007, `routes/receipts.js`, `pages/Sell.jsx`): bursar of own school, student name/class typed (linked to students in Step 1b), boy/girl price, cash/bank/mobile money with slip or transaction number, always full amount, check screen before saving, A5 printed receipt with amount in words
- [x] Receipt numbers per school without gaps: REC.0001, REC.0002 … (migration 011; each school has its own book, so the number is unique per school). The school row is locked while the receipt is saved; a double click returns the same receipt (`client_key`)
- [x] Printed receipt copies the school's receipt book (A5 landscape, blue, red number): name, P.O. Box/phones/email, No., SCHOOL UNIFORM RECEIPT, Date, Received from / Class, ITEM / No. ITEM / AMOUNT, sum in words, Banked on, TShs box, "For :" signature line, "Once fee paid is not refundable". Super Admin edits the header, the "For :" line and the next receipt number (up only, to continue from the paper book) on the Schools page
- [x] Nobody can cancel, delete or change a receipt: refused by the API and by database triggers (only "given" status and given quantities move forward)
- [x] Give items (`pages/Give.jsx`): librarian of own school finds the receipt by number or name, gives all or part, notes who collected; cannot give more than paid or take back
- [x] Receipts page (`pages/Receipts.jsx`) for administration, Head Master, bursar, librarian: live, money today by cash/bank/mobile, not-given and late counts, filters, receipt details with give history, print again
- [x] Late alert: a receipt paid but not fully given after 24 hours (`RECEIPT_LATE_HOURS`) sends one notification to its library and administration (checked every 5 minutes)
- [x] Excel: receipts + items sold (two sheets), same filters as the page
- [x] Tests: `test/receipts.test.js` (9 checks) + browser run bursar → librarian → accountant, desktop and phone
- [x] Stock levels (`pages/Stock.jsx`): only finance office, accountant office and leaders (not bursar, librarian, Head Master). In stock, paid-not-given, free, on the way, damage waiting, reorder level (FM / Accountant set it), low / out, stock card per item. `stock_moves` keeps every movement (never changed); `lib/stock.js` is the only way stock changes
- [x] Giving takes items out of stock; not enough recorded = refused with a clear message. Low stock (crossing the reorder level) tells finance
- [x] Damaged / lost (`routes/damage.js`, `pages/Damage.jsx`): librarian reports DMG.0001…; only Finance Manager or Accountant approves (not their own); approved = out of stock; reject needs a reason
- [x] Stock requests (`routes/requests.js`, `pages/Requests.jsx`): librarian asks REQ.0001…; finance "Send" opens Send stock filled in (request becomes "sent"), or declines with a reason; librarian can withdraw while waiting
- [x] Control numbers (`routes/bills.js`, `pages/Bills.jsx`, Sell → "Control number"): 12 digits = 88 + school + running number + check digit; valid 7 days (`BILL_DAYS`), renew, cancel before payment with a reason. Bursar or Accountant marks paid with the bank / mobile money reference: the receipt is written then (same REC. book, method "Control number"); a paid control number never changes (database guard)
- [x] Daily money (`routes/money.js`, `pages/Money.jsx`): each bursar per day (cash, bank, mobile, control); the accountant types the cash received / banked, saved once (short / over needs a note; the bursar and FM are told). Bursar sees only own days
- [x] Sales dashboard (`/api/dashboard/sales`, `pages/SalesDashboard.jsx`): finance office + accountant office (+ Super Admin, Director). Money in for any days, vs the days before, by payment, school, class, item, seller; control numbers waiting; paid not given
- [x] Reports page (`routes/reports.js`, `pages/Reports.jsx`), list per role in `roles.js` REPORTS: Sales book (same layout as UNIFORM SALES-2026.xlsx, one sheet per month), Items sold, Daily money, Control numbers, Paid not given, Stock levels, Stock card, Deliveries, Requests, Damaged / lost
- [x] Tests: `test/stock.test.js` (10) — all 47 API tests pass as the restricted `musabe_app` account

## Step 2 notes
- Stock starts at 0. Before the library gives anything, the finance office sends the opening stock (Send stock, note "Opening stock") and the librarian confirms it. Receipts given before 2026-11-14 were not taken out of stock.
- After pulling: `npm run migrate`, then run `db/provision-roles.sql` again so the new tables get the right (no delete) rights.
- Who sees what (2026-11-14): sales report download = bursar (own school), accountant office, finance office (+ leaders); sales dashboard = finance + accountant offices only; stock levels = accountant + finance offices only.

## Dashboards, notifications, security (2026-11-14)
- [x] Home "To do" for every role (`routes/dashboard.js` todo()): only the work waiting for that person and only pages they may open — receipts to give, deliveries to confirm / not confirmed, requests, damage to approve, stock out / low, control numbers waiting / expired, bursar days not checked, days short / over, uploads and class lists waiting, password requests, locked accounts
- [x] Librarian home: stock coming, own requests and damage reports. Bursar home: own control numbers waiting, accountant's checks of own days
- [x] Notifications open the right page (`notify.js` linkFor). Reminders (`lib/reminders.js`, every 15 min, each sent once via `alerts_sent`): delivery not confirmed after 48 h, control number expiring / expired, daily money not checked (once a day after 08:00), damage and requests waiting 48 h
- [x] Security batch 2 (migration 013, `lib/guard.js`): 12-character passwords without common words or own name; temporary passwords expire after 72 h; same reply for unknown user / wrong password / lock; lock per address (5) and per account (20); failed logins and refusals logged; idle sessions end (2 h / 7 days) and are cleaned hourly; `__Host-` Secure cookie in production; Origin check on every change; CSP/HSTS/Permissions-Policy/no-store; API and upload rate limits; live connection limits; upload zip checks; Excel formula guard; activity log and price history cannot be changed by any account; health hides details; config checked at start; optional database SSL; school list hides staff details from other roles
- [x] Tests: `test/security.test.js` (13, includes the role × page matrix) — 60 tests pass as `musabe_app`
- [x] `docs/deployment.md`: production `.env`, Nginx headers, update steps

## Barcodes, main store, issuing, weekly check (2026-11-16)
Agreed 2026-11-16: everything bought and used has a barcode and is given out by scanning. Things that come back have a barcode on every piece. Everyone has an ID that is scanned when receiving and returning. The store-keeper buys; the Accountant and the Assistant Accountant confirm everything bought. Food and other supplies are checked every week and a ledger is kept.
- [x] Migration 014 (`20261116_014_barcodes_store_issue`): role Store-keeper (administration); items get unit / comes back / for sale; new categories Laboratory, Food, Cleaning, Equipment; `item_barcodes`, `item_copies`, `issues`, `issue_lines`, `purchases`, `purchase_lines`, `stock_counts`, `stock_count_lines`; main store = `school_id` NULL in the stock tables
- [x] Codes (`lib/codes.js`): MI = item, MC = one piece, MS = student ID, MU = staff ID (made from the row id); any other code is the maker's barcode saved for an item
- [x] Purchases (`routes/purchases.js`, `pages/Purchases.jsx`): store-keeper writes PUR.0001 (supplier, invoice, items, cost); Accountant / Assistant Accountant confirms line by line what was really bought (fewer = note); only then it is in the main store; reject needs a reason; decided once
- [x] Main store (`pages/Store.jsx`): levels, bought-not-confirmed, reorder level, history; store-keeper / Finance Manager add things that are not for sale and mark "comes back"
- [x] Send stock from the main store: a delivery by the store-keeper takes the stock out of the main store when sent; cancel puts it back. Things not for sale need no price to be sent to a library
- [x] Scan out / return (`routes/store.js`, `pages/Issue.jsx`): librarian (own library) and store-keeper (main store). Scan the ID, scan the things, save ISS.0001. Pieces go only to a person with an ID; things that do not come back also to a place (kitchen). Return: good = back in stock; damaged / lost = out of stock, note needed, Head Master and finance told
- [x] Barcodes & ID cards (`pages/Labels.jsx`, `components/barcode.jsx`): item labels, maker's barcode, a barcode for every piece (never more pieces than the stock), ID cards for students and staff; A4 print (3 labels across, 10 cards a page). Code 128 drawn by the app, checked against the jsbarcode library
- [x] Scanner (`components/scan.jsx`): USB / Bluetooth scanner or typing; phone camera in Chrome on Android (needs https; Nginx header now `camera=(self)`)
- [x] Weekly check (`routes/counts.js`, `pages/Counts.jsx`): keeper counts without seeing the system number (CNT.0001); accountant office confirms; differences correct the stock ("count" move, note needed); one waiting check at a time. Weekly ledger for any week and store: opening, received, given out, corrections, closing, counted, difference + Excel
- [x] Home: Store-keeper home; "To do" lines for purchases and checks to confirm, weekly check not done, pieces out
- [x] Tests: `test/store.test.js` (8) — 68 tests pass as `musabe_app`. Browser run: accountant, store-keeper, librarian (desktop and phone), printed sheets checked as PDF
- After pulling: `npm run migrate`, then run `db/provision-roles.sql` again (new tables get their no-delete rights). Then Staff accounts → New account → Store-keeper.
- Not yet: staff without an account (cooks, guards) have no ID card (give to a place instead); Excel upload of purchases; due dates and reminders for things not returned; reports of issues on the Reports page (Excel is on the pages).

## ID cards, two store-keepers, school requisitions (2026-11-16, part 2)
Agreed 2026-11-16: every student and staff has an ID with a QR code, shown on their profile with "issued / not issued" (the School Admin hands them out). Two store-keepers: one buys, the other counts with the accountant office. Schools ask through the Academic Master → Head Master → store-keeper → Manager; then the store-keeper buys, the purchase is checked, the librarians check what arrives and both sides sign.
- [x] Migration 015 (`20261116_015_idcards_requisitions_checks`): `id_cards` (card 1, 2 … per person, closed as lost / damaged / returned / mistake; one card in use; never deleted), `requisitions` + `requisition_lines`, purchases get `checked_by` / `requisition_id` and status "checked", deliveries get `requisition_id`; database guards: purchases and requisitions only move forward, an ID card is only closed once
- [x] ID cards (`routes/idcards.js`, `components/idcard.jsx`, `components/qr.jsx`): QR code (package `qrcode-generator`) with the same code as before (MS… / MU…), read back from the printed PDF. Card on the student page, on "My profile" and in Staff accounts (ID card button). School Admin: own school's students and staff; Super Admin: administration staff. "Mark as issued" one by one or tick many on Barcodes & ID cards → ID cards (filter Not issued / Issued). Scanning an ID shows "ID card not issued". Home "To do" for the School Admin: students / staff without a card
- [x] Purchases in three steps: store-keeper buys → the OTHER store-keeper counts (with the accountant office) → Accountant / Assistant Accountant confirms → main store. The buyer cannot count, the counter cannot confirm. Goods received note (GRN) prints with the three names and signature lines
- [x] Delivery note (DLV) prints with "Sent by" and "Received and checked by (librarian)" and signature lines, on Send stock and Incoming stock
- [x] School requisitions (`routes/requisitions.js`, `pages/Requisitions.jsx`): Academic Master asks (items from the list or typed new) → Head Master signs → store-keeper signs (links each line to an item, cost of one, main store stock) → Manager signs (may give fewer, with a note) → store-keeper "Buy it" (purchase linked, checked as above) or "Send" when the main store has enough → librarian confirms → done. Reject at any signature needs a reason; withdraw until the Head Master signs. Requisition form prints with the four signatures. Notifications and "To do" for each signer; the Academic Master follows their own
- [x] Tests: `test/requisitions.test.js` (3) + `test/store.test.js` updated — 71 tests pass as `musabe_app`. Attack script run again with the new routes: 0 findings. Browser run with all roles; printed cards, delivery note and requisition form checked as PDF
- After pulling: in `frontend` run `npm install` (new package), in `backend` `npm run migrate`, then run `db/provision-roles.sql` again. Create the second Store-keeper account.
- Not yet: photos on ID cards; the old one-step purchase confirm is gone (purchases still waiting from before must now be counted by the other store-keeper first).

## No main store, orders, NIDA-style ID cards, selling out of stock (2026-11-16, part 3)
Agreed 2026-11-16: there is no main store — goods land at the office and go to the school. The store-keeper can place an order and it is approved when the goods arrive. Scanning is done with a phone or a USB / Bluetooth QR scanner (like a supermarket), not the web camera. The store-keeper never sees selling prices, only what things cost. Requisitions can start from the Head Master. The librarian is the only one who gives out (sold things against the bursar's receipt, used things by issuing). The bursar may sell a thing that is not in stock: the receipt says so and the child gets it when it arrives. Parents are told every time a child receives something (parents' app later).
- [x] Migration 016 (`20261116_016_no_main_store_photos_parents`): purchases get school, ordered, expected date, delivery; pieces "coming"; ID photos; `parent_notices`; receipt lines marked out of stock
- [x] Purchases & orders (`routes/purchases.js`, `pages/Purchases.jsx`): "Bought now" or "New order" for one school → the other store-keeper counts when it arrives → accountant confirms → a delivery to that school's library is made at once (with QR labels to print) → the librarian signs. The writer can cancel an order still waiting
- [x] Items to issue (`pages/Store.jsx`, `/api/store/items/import`): the list of things used and not sold, with Excel template and upload; "comes back" = one QR per piece
- [x] QR labels for a delivery (`/api/store/delivery-labels/:id`, "Print QR labels" on purchases and Send stock)
- [x] ID cards like the national ID (`components/idcard.jsx`): colour per school and for staff of each school and administration, photo upload, front + back with QR, print 10 a page
- [x] Selling out of stock (`/api/receipts/availability`): warning on Sell, "*" on the receipt, notice to the parent, the librarian cannot give what is not there; Give: scan the student ID or the receipt, then scan each item
- [x] Super Admin: reports of students uploaded and student lists. School Admins upload
- [x] Test files `docs/test-data/` (items for sale, items to issue, opening stock for the 3 schools) and `test/testdata.test.js` that loads them. 73 tests pass; attack run: 0 findings

## Attack run (2026-11-16)
The app was attacked on a throwaway database (scripts kept outside the repo). Held: no page without sign-in (92 routes), no data of another school (4,700 requests with planted markers), no role escalation, prices and receipt numbers cannot be chosen by the client, double clicks and 8 requests at once give one receipt / one give, the app's database account cannot change or delete money history. Fixed:
- [x] Excel "zip bomb" that lies about its size (300 KB → 300 MB in memory): each part is now unpacked with a hard 60 MB limit before reading (`lib/excel.js`, test added)
- [x] Change password: 10 wrong tries per 15 minutes (was unlimited from a signed-in screen)
- [x] Cross-site check no longer believes `X-Forwarded-Host`; in production only `APP_ORIGIN`
- [x] Strange input (letters for numbers, huge numbers, broken characters) answers 400, not 500
- [x] School list: School Admin names and staff counts of other schools hidden from school staff
- Still open (not code): MFA for finance roles; a bursar can mark own control number paid (accountant must check bank references); backups; local `.env` still runs as `postgres` with `SUPERADMIN_PASSWORD` inside.

## Parents' mobile app — first part (2026-11-18)
- [x] Migration `20261118_025_parent_accounts`: parents, parent_sessions, parent_codes, parent_requests, student_guardians (+ grants in `db/provision-roles.sql`)
- [x] Sign-in with no password: phone on the student's record → 6-digit SMS code (10 min, 5 tries, 3 codes / 15 min) → token in the phone's secure storage (180 days, 60 days idle, max 5 phones)
- [x] One parent, many children, any of the three schools (all students with that phone, plus second parents linked by the School Admin)
- [x] API `/api/parent`: me, children (details, ID card, receipts + collected or not, control numbers to pay, things given out / returned), notices (read / unread), "my child is not here" requests. Messages in Kiswahili or English (X-Lang)
- [x] Web: Students → Parents' app requests (School Admin links the parent, or answers why not). Bell tells the School Admin
- [x] App `Parents/` (Expo): splash → sign in → my children grouped by school → child (overview, receipts, control numbers, given out) → notices → account (name, language, sign out) → requests. Kiswahili default, English switch
- [x] Tested: `backend/test/parents.test.js` (5 checks) + full API run on a test database
- [ ] Push notifications to the phone (needs an EAS build; SMS for urgent ones)
- [ ] School fees (karo), exam results and report cards in the app (when those parts of the system exist)
- [ ] Staff mobile app: only roles with phone work (e.g. librarian scan) get in; others see "nothing for you on the phone yet"

## Step 3 — Academic
- [ ] Subjects, topics, teaching assignments
- [ ] Exam sets and papers
- [ ] Marks entry + Excel upload
- [ ] Results and students to watch
- [ ] Support plans, question bank

## Step 4 — Dashboards & reports
- [x] Role home pages (2026-11-13, `routes/dashboard.js`, `pages/home/RoleHomes.jsx`, `test/dashboard.test.js`): each role its own set, live —
  Director (money today/week/month, 30-day chart, schools, students, top items); Manager (receipts to follow up, schools, top items);
  Finance (money, chart, items without price, uploads waiting); Accountant (each bursar today by cash/bank/mobile, late receipts);
  Super Admin (whole system + accounts); School Admin (students per class, no-phone, lists waiting + accounts); Head Master (own school: money, library, classes);
  Bursar (my sales today, my receipts at the library, New sale); Librarian (waiting oldest first with Give, given today); Academic (students per class)
- [ ] Reports + export
- [ ] Settings

---

## Notes
- 2026-10-15: Repository started with documentation only.
- 2026-11-10: Plan changed: one system with modules; library = sales flow (bursar → library). Step 1a built.
- Sessions are stored in PostgreSQL (no Redis needed yet).
- Rule for new screens: call `useLive([...areas], load)`; every change must go through `audit()` (or `publish()`) so other screens update.
- Nginx: live updates work with the normal proxy; the server sends `X-Accel-Buffering: no` and a ping every 30 s.
- 2026-11-11: Each person's look (theme, text size) is saved on the server and cached in the browser. Sidebar "System settings" (Super Admin) is still for Step 4.

## Store-keeper office, Order Book, Assistant Manager, help chat (2026-11-20)
Agreed 2026-11-20: only the people sent to buy (Assistant Manager, store-keeper) write payment requisitions; everyone else uses the Order Book. Money is approved by the Manager OR the Finance Manager. Teachers order from the Academic Master; the Academic Master orders straight from the store-keeper; the librarian and the School Store-keeper go through the Head Master, then the Manager.
- [x] Migration `20261120_029_amanager_order_book`: role Assistant Manager (`amanager`), tables `orders` + `order_lines` (move forward only, never deleted); `db/provision-roles.sql` has the new tables
- [x] Order Book (`routes/orders.js`, `pages/Orders.jsx`): paper ORDER layout (No. ORD.0001, M/s, Qty / Particulars, signatures); teacher → Academic Master (gives it or sends it on) → store-keeper; librarian / School Store-keeper → Head Master → Manager → store-keeper; signers may give fewer; store-keeper "Write the requisition" (prefilled) or reject with a reason; Excel; To do and bell for each signer
- [x] Requisitions (`routes/requisitions.js`): written only by `amanager` / `storekeeper`, for a chosen school (or from an order), every line with an amount; starts at the money step; Manager or Finance Manager approves (never their own); old school-written requisitions still finish the old way
- [x] Store-keeper / Assistant Manager home: orders to buy for, requisitions with the Manager / FM, approved to buy
- [x] Fixed: daily purchases form "Sign and send to Mapokezi" opened nothing (could not be saved); store-keeper could not cancel his own order; a new requisition stayed on the edit form after sending; the public paper check (QR) showed no number
- [x] Help chat (`routes/help.js`, `src/help/pages.js`, `components/HelpChat.jsx`): a Help button on every account. The AI (Claude Haiku 5.5) gets ONLY the how-to notes of the pages that role can open, no data, no tools, chats not saved. Needs `ANTHROPIC_API_KEY` in `backend/.env`
- [x] Tests: `test/orders.test.js` (4), `test/help.test.js` (1), requisitions and store tests updated — 89 tests pass
- After pulling: `npm run migrate`, then run `db/provision-roles.sql` again. Create the Assistant Manager account (Staff accounts → New account). Put `ANTHROPIC_API_KEY=` in `backend/.env` for the help chat.
- Not yet: multiple roles per person; Second Master + Issue Note; School Store-keeper giving out; GRN at school (Bursar → Head Master); stock per place; price list / proforma + LPO; supplier debts; Summary of Goods Received.

## Money back, closing by itself, signatures, paper size (2026-11-20, evening)
- [x] Buying with office money that is spent exactly closes by itself when Mapokezi accepts the goods (no Cashier step; nothing to give back). Money left over still goes to the Cashier.
- [x] Mapokezi rejects → the buyer chooses: "Go back to the market (new buying form)" or "Give the money back to the Cashier". The Cashier types what he received and signs; the requisition becomes "closed" (migration `20261120_030_money_back`). Cashier "To do" shows buyers bringing money back
- [x] Requisition shows every buying form: rejected ones say "then bought again on PUR.000x"; the Order Book shows how far the buying went (being bought, sent, received, money given back)
- [x] Signatures: "Photo of my signature on paper" (paper made see-through, empty space cut, max 360x120) or draw it; on papers a signature sits on its own dotted line in the middle (max 48px high)
- [x] Papers smaller: about 720px wide, smaller letters, fewer empty rows
- [x] Tests: `test/moneyback.test.js` (3) — 92 tests
- After pulling: `npm run migrate`. Ask each person to upload a photo of their signature again in My profile.

## Many roles, Patron, "Went with", Store books (2026-11-20, night)
- [x] One person, many roles (migration 031): Staff accounts → Roles; "Working as" in the menu; blocked pairs (roles.js BLOCKED_PAIRS); activity log keeps the role used; notifications for all roles
- [x] Patron / Matron role; teachers no longer use the Order Book; School Store-keeper and Patron orders: Head Master → buyers; librarian: Head Master → Manager
- [x] Payout vouchers: Manager or Finance Manager authorizes
- [x] "Went with" on the buying form (migration 032): the second buyer signs before Mapokezi checks
- [x] Store books (migration 033, `routes/storebooks.js`, `pages/StoreBooks.jsx`): store-keeper's folders (FOODS...) and items (MCHELE kg...); received / sent to a place / used / corrected; what is left in the store and at each place; Excel; lines never changed
- After pulling: `npm run migrate`, then `db/provision-roles.sql` again.

## Classes from built-in levels (Academic Master), admission interviews (2026-11-20, late night)
Agreed 2026-11-20: class names are built into the system; the Academic Master (not the School Admin) adds the classes and streams. After the admission interview the child's details are kept: exam centre, names, previous school, marks, result, parent contacts, date; marks are entered by a secretary under the Assistant Director.
- [x] `src/lib/levels.js`: built-in levels per school (English Medium: BABY CLASS, PREP ONE, PREP TWO, PRIMARY ONE … SEVEN; secondary: FORM ONE … FOUR) with the default curriculum (new / old / school's own)
- [x] Migration `20261120_034_levels_interviews`: classes.level + classes.curriculum (old classes matched by name), role Academic Secretary (`secretary`), table `admission_interviews` (never deleted), students.interview_id
- [x] Classes page: Academic Master (own school) and Super Admin add a class from the list with several streams at once, set the curriculum, fix old hand-typed classes; everyone else only looks (page key `classlist`)
- [x] Admission interviews page (`routes/interviews.js`, `pages/Interviews.jsx`): Secretary / Assistant Director add one or upload Excel (subject columns found by name, check before save); filters; Excel export; School Admin presses "Register" → Add student filled in; the interview shows on the student's page; Home "To do" lines
- [x] Tests: `test/interviews.test.js` (2), `test/students.test.js` updated — 98 of 102 pass on a test database (the 4 others need the owner account or docs/test-data; unchanged)
- After pulling: `npm run migrate`, then run `db/provision-roles.sql` again. Create the Academic Secretary account (Staff accounts → New account).
- To confirm with the school: the pre-primary class names (BABY CLASS, PREP ONE, PREP TWO) and default curricula.

## Office buying: Assistant Accountant check, suppliers, price lists, LPO, debts, no receipt, goods summary, agreements, vehicles (2026-11-21)
- [x] Migration `20261121_035_office_buying` (+ `db/provision-roles.sql` grants)
- [x] Requisitions: new step **check** — the Assistant Accountant checks prices and sums (may fill empty amounts, send back, reject) before the Manager / Finance Manager approves. A requisition can point to the supplier's price list / proforma; "see the paper" link
- [x] Suppliers page (`routes/suppliers.js`, `pages/Suppliers.jsx`): supplier list with payment terms (cash, weekly, monthly, other); price lists / proforma invoices typed as on the paper + photo or PDF (added once, never changed); supplier account: goods on credit, payments (accountant office or FM, with reference), balance; Excel
- [x] LPO (`routes/lpos.js`, `pages/Lpo.jsx`): paper layout (To, Our Ref, Ship to, SL No., Description, Unit, Rate, Amount, Total, Prepared / Certified / Authorised by); prepared by Assistant Manager / store-keeper → certified by the Accountant (may fill empty rates) → authorised by the Manager or the Finance Manager; PIN signatures and seal + QR; fill lines from a price list; cancel before goods; "delivered" when the goods are confirmed
- [x] Purchases: supplier from the list (or a small shop typed), from an LPO, on credit; Mapokezi ticks "No receipt" with the reason → Finance Manager, Manager and Director are told (not assistants)
- [x] Purchases split: confirm (Cashier / Assistant Accountant) no longer sends; the store-keeper presses "Send to the school" (requisition shows "Bought: to send"); To do line for the store-keeper
- [x] Summary of Daily Goods Received (`/purchases/summary`): paper layout of book 1701 for any dates, cash / credit, no-receipt lines, print + Excel
- [x] Work agreements — Makubaliano ya Malipo ya Kazi (`routes/contracts.js`, `pages/Contracts.jsx`): entered by the Assistant Accountant with a copy of the signed paper; instalments with balance (salio), never more than agreed; checked by the Accountant (Imekaguliwa na); stop / finished
- [x] Vehicles (`routes/vehicles.js`, `pages/Vehicles.jsx`): plate, make, use, school, responsible driver now, driver history
- [x] Tests: `test/office.test.js` (5) + requisitions / orders / moneyback / store tests updated — 103 of 107 pass (same 4 as before need the owner account or docs/test-data)
- After pulling: `npm run migrate`, then run `db/provision-roles.sql` again. The Assistant Accountant now signs every requisition before the Manager.
- Not yet: number series per school and per place (with stock per place); LPO paper not yet compared with a photo of the real LPO book.
