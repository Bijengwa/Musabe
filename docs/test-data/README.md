# Test data: items, opening stock and students

## Student class lists and guardian workbook (remade 2026-11-23)

- `docs/class/Musabe_<Class>_Students.xlsx`: 10 class lists (Baby, Middle, Nursery, P1 to P7), 200 students each. Upload each one on Students → Upload class list, choosing the matching class (Baby → BC, Middle → PP 1, Nursery → PP 2).
- `2000-students-guardian-template.xlsx`: the same 2000 students in one sheet, with a Class column (for looking, not for upload: the upload takes one class per file).
- Made by `docs/class/make_class_files.py` (run it again to remake them).
- Real families: brothers and sisters share the father's surname and are in different classes; one guardian = one name and one phone on all their children; names are full names (JOHN MATHIAS MREMA), never "Mr John" or "Mama Simon".
- Guardians per student: mostly Father + Mother; some single parents with a grandmother, uncle or aunt; some orphans with an uncle and aunt; some with 4, 5 or 6 guardians.

# Test data: items and opening stock

Load in this order:

1. **1-items-for-sale-and-prices.xlsx** (uniform, socks, exercise books…) — Finance Manager: *Items & prices → Upload Excel → Approve*.
2. **2-items-to-issue.xlsx** (text books, reams, chalk, lab instruments, food) — Store-keeper or Finance Manager: *Items to issue → Upload Excel*.
3. **3a / 3b / 3c opening stock** (one per school) — Finance office: *Send stock → choose the school → Upload Excel → Check and send*. Then the librarian of that school confirms on *Incoming stock*.

After that:
- Sell: bursar writes a receipt → the librarian scans the student ID (or the receipt) and the QR on each thing.
- Issue: the librarian scans the ID, then the books / reams.
- Print QR labels: Store-keeper on *QR labels & ID cards*, or *Print QR labels* on a purchase / delivery.
